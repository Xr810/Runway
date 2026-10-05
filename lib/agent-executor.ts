import { createHash } from "node:crypto";
import { z } from "zod";
import { atomicAgentWrite } from "./postgres";
import { type AgentDraft } from "./agent-contract";
import { saveEntry, deleteEntry, undeleteEntry, listEntries } from "./entries";
import { saveGig, listGigs } from "./part-time";
import { saveWatch } from "./watch-storage";
import { saveReminder, deleteReminder, markReminder } from "./reminders";
import { saveDirectory } from "./directory-storage";
import { directorySchema, identity } from "./journey";
import { watchSchema } from "./watches";
import { entrySchema } from "./model";
import { gigSchema } from "./part-time-contract";
import { lockEnrichment, saveEvaluationProfile, syncEnrichment } from "./enrichment";
import { targetSchema } from "./enrichment-contract";
import { scanSettings, saveScanSettings } from "./scanner";
import { getAiConfig, saveAiConfig } from "./ai-config";
import { markNotifications, notify } from "./notifications";
import { localFiles } from "./files";
import { validImageData, type aiImageSchema } from "./ai-contract";
import type { AgentOutcome, AgentDecision } from "./agent-runtime-contract";
import { draftCommand, isAgentJob } from "./agent-commands";
import { agentPolicy, assertAgentCommand } from "./agent-policy";

export async function executeAgentDraft(
  runId: string,
  draft: AgentDraft,
  decision: AgentDecision,
  images: z.infer<typeof aiImageSchema>[] = [],
): Promise<AgentOutcome> {
  const command = draftCommand(draft);
  // Re-read grants at execution, including checkpoint replay; planning is not authorization.
  if (decision.approved) assertAgentCommand(agentPolicy(await getAiConfig()), command);
  return atomicAgentWrite(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [draft.id]);
    const existing = (
      await client.query("SELECT run_id,result FROM agent_operations WHERE id=$1", [draft.id])
    ).rows[0];
    if (existing) {
      if (existing.run_id !== runId) throw Error("操作不属于本次会话");
      return existing.result;
    }
    let result: unknown = null,
      status: AgentOutcome["status"] = "rejected";
    if (decision.approved) {
      const body = draft.body as Record<string, unknown>;
      if (draft.warnings?.length && !decision.allowDuplicate)
        throw Error("请先核对可能重复的记录并勾选确认。");
      if (isAgentJob(command)) {
        await client.query("INSERT INTO agent_jobs(id,run_id,kind,payload) VALUES($1,$2,$3,$4)", [
          draft.id,
          runId,
          command,
          JSON.stringify(body),
        ]);
        result = { jobId: draft.id };
        status = "queued";
      } else {
        switch (command) {
          case "entries": {
            if (body.action === "save") {
              const entry = entrySchema.parse(body.entry);
              if (
                !entry.revision &&
                !decision.allowDuplicate &&
                (await listEntries()).some(
                  (e) =>
                    e.kind === entry.kind &&
                    ((entry.url && e.url === entry.url) ||
                      (identity(e.title) === identity(entry.title) &&
                        identity(e.organization) === identity(entry.organization))),
                )
              )
                throw Error("发现重复记录，请核对后重新提案。");
              result = await saveEntry(entry);
              for (const imageId of draft.sourceImageIds ?? []) {
                const image = images.find((i) => i.id === imageId);
                if (!image || !validImageData(image.dataUrl))
                  throw Error("来源截图缺失，请重新发送截图后生成提案。");
                const mime = image.dataUrl.slice(5, image.dataUrl.indexOf(";"));
                const bytes = Buffer.from(image.dataUrl.split(",")[1], "base64");
                const fileId =
                  "ag_" +
                  createHash("sha256")
                    .update(draft.id + ":" + image.id)
                    .digest("hex");
                await localFiles.put(fileId, new Blob([new Uint8Array(bytes)]).stream());
                await client.query(
                  "INSERT INTO files(id,entry_id,name,type,size,created) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(id) DO NOTHING",
                  [
                    fileId,
                    entry.id,
                    image.name.replace(/\.[^.]+$/, "") +
                      (mime === "image/jpeg" ? ".jpg" : mime === "image/png" ? ".png" : ".webp"),
                    mime,
                    bytes.length,
                  ],
                );
              }
            } else if (body.action === "delete") {
              await deleteEntry(z.string().parse(body.id), z.number().parse(body.revision));
              result = { deleted: body.id };
            } else if (body.action === "undelete") {
              const row = (
                await client.query(
                  "SELECT revision FROM entries WHERE id=$1 AND deleted_at IS NOT NULL FOR UPDATE",
                  [body.id],
                )
              ).rows[0];
              if (!row || row.revision !== body.revision)
                throw Error("回收站记录已变化，请重新提案。");
              await undeleteEntry(z.string().parse(body.id));
              result = { restored: body.id };
            } else throw Error("不支持的记录操作");
            await syncEnrichment();
            break;
          }
          case "gigs": {
            const item = gigSchema.parse(body),
              current = await listGigs();
            const old = current.find((g) => g.id === item.id);
            const duplicate =
              !item.revision &&
              current.some(
                (g) =>
                  identity(g.title) === identity(item.title) || (item.url && item.url === g.url),
              );
            const added = item.payments.filter((p) => !old?.payments.some((o) => o.id === p.id));
            const duplicatePayment = added.some((p) =>
              [...(old?.payments ?? []), ...added].some(
                (o) =>
                  o.id !== p.id &&
                  !o.voided &&
                  o.amountMinor === p.amountMinor &&
                  o.currency === p.currency &&
                  o.date === p.date &&
                  o.period === p.period,
              ),
            );
            if ((duplicate || duplicatePayment) && !decision.allowDuplicate)
              throw Error("发现可能重复的兼职或收入，请核对后重新提案。");
            result = await saveGig(item);
            break;
          }
          case "directory":
            result = await saveDirectory(directorySchema.parse(body.directory));
            await syncEnrichment();
            break;
          case "watches":
            result = await saveWatch(
              watchSchema.parse(body.watch),
              body.action === "delete" ? "delete" : "save",
            );
            await syncEnrichment();
            break;
          case "reminders":
            if (body.action === "save") result = await saveReminder(body.reminder);
            else {
              const old = (
                await client.query("SELECT revision FROM reminders WHERE id=$1 FOR UPDATE", [
                  body.id,
                ])
              ).rows[0];
              if (!old || old.revision !== body.revision) throw Error("提醒已更新，请重新提案。");
              if (body.action === "delete") await deleteReminder(z.string().parse(body.id));
              else if (body.action === "done")
                await markReminder(
                  z.string().parse(body.id),
                  z.string().date().parse(body.day),
                  z.boolean().parse(body.done),
                );
              else throw Error("不支持的提醒操作");
              result = { ok: true };
            }
            break;
          case "profile":
            result = await saveEvaluationProfile(body.profile);
            break;
          case "evaluation":
            result = await lockEnrichment(
              targetSchema.parse(body.target),
              z.boolean().parse(body.locked),
            );
            break;
          case "scanSettings":
            if (JSON.stringify(await scanSettings()) !== JSON.stringify(body.before))
              throw Error("扫描设置已变化，请重新提案。");
            result = await saveScanSettings(body.settings);
            break;
          case "model": {
            const current = await getAiConfig();
            if (current.revision !== body.revision || current.base !== body.base)
              throw Error("模型设置已更新，请重新提案。");
            const config = await saveAiConfig(
              { ...current, model: z.string().min(1).max(250).parse(body.model) },
              current.revision,
            );
            result = { model: config.model, revision: config.revision };
            break;
          }
          case "notifications":
            await markNotifications(
              z.enum(["read", "dismiss"]).parse(body.action),
              z.array(z.string().uuid()).parse(body.ids),
            );
            result = { ok: true };
            break;
          default: {
            const unhandled: never = command;
            throw Error(`不支持的站内操作：${unhandled}`);
          }
        }
        status = "done";
      }
      await notify(
        {
          actor: "Runway Agent",
          action: "agent.operation",
          summary: draft.title,
          changes: draft.changes,
        },
        client,
      );
    }
    const outcome: AgentOutcome = {
      status,
      result,
      message:
        status === "queued"
          ? "已加入后台任务，完成后更新结果。"
          : status === "rejected"
            ? "已拒绝，未执行。"
            : "已完成。",
    };
    await client.query(
      "INSERT INTO agent_operations(id,run_id,decision,result) VALUES($1,$2,$3,$4)",
      [draft.id, runId, decision.approved ? "approved" : "rejected", JSON.stringify(outcome)],
    );
    return outcome;
  });
}
