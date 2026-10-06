import type { AgentDraft, AgentSnapshot } from "./agent-contract";
import type { AiReply } from "./ai-contract";
import { changes, prepareAgentActions, createAgentDraft } from "./agent-contract";
import { draftCommand } from "./agent-commands";
/** Compatibility only: all generations end up in the same persisted operation registry. */
export function centralizeReply(reply: AiReply, s: AgentSnapshot): AiReply {
  const actions: AgentDraft[] = [...(reply.actions ?? [])];
  const draft = createAgentDraft;
  for (const d of reply.drafts)
    actions.push({
      ...draft(
        (d.operation === "add" ? "新增：" : "修改：") + d.entry.title,
        "entries",
        { action: "save", entry: d.entry },
        changes(s.entries.find((e) => e.id === d.entry.id) ?? {}, d.entry, d.changedFields),
      ),
      sourceImageIds: d.sourceImageIds,
      warnings: d.duplicates.map((x) => "可能重复：" + x.title),
    });
  for (const d of reply.partTime)
    actions.push({
      ...draft(
        "兼职：" + d.item.title,
        "gigs",
        d.item,
        changes(s.gigs.find((g) => g.id === d.item.id) ?? {}, d.item, Object.keys(d.item)),
      ),
      warnings: d.warnings,
    });
  for (const d of reply.reminders)
    actions.push(
      draft(
        "提醒：" + d.reminder.title,
        "reminders",
        d.operation === "delete"
          ? { action: "delete", id: d.reminder.id, revision: d.reminder.revision }
          : { action: "save", reminder: d.reminder },
        changes(
          s.reminders.find((r) => r.id === d.reminder.id) ?? {},
          d.operation === "delete" ? {} : d.reminder,
          Object.keys(d.reminder),
        ),
      ),
    );
  for (const d of reply.watches)
    actions.push(
      draft(
        "关注：" + d.watch.company,
        "watches",
        { action: "save", watch: d.watch },
        changes(s.watches.find((w) => w.id === d.watch.id) ?? {}, d.watch, Object.keys(d.watch)),
      ),
    );
  const extra: unknown[] = reply.directory.map((d) => ({
    module: d.kind,
    operation: "add",
    fields: { name: d.name, [d.kind === "company" ? "website" : "url"]: d.url, logoUrl: d.logoUrl },
  }));
  if (reply.profile) extra.push({ module: "profile", operation: "update", fields: reply.profile });
  if (reply.scan)
    extra.push({ module: "scan", operation: "run", watchIds: reply.scan.watchIds ?? undefined });
  if (reply.completeCompanies)
    extra.push({
      module: "companyCompletion",
      operation: "run",
      names: reply.completeCompanies.names ?? undefined,
      refreshLogo: reply.completeCompanies.refreshLogo,
    });
  if (reply.enrichment)
    extra.push({
      module: "assessment",
      operation: "run",
      ...reply.enrichment,
      target: reply.enrichment.target ?? undefined,
    });
  actions.push(...prepareAgentActions(extra, s));
  const touched = new Set<string>();
  for (const a of actions) {
    const b = a.body as Record<string, unknown>;
    const entity = (b.entry ?? b.watch ?? b.reminder ?? b) as Record<string, unknown>;
    const key = draftCommand(a) + ":" + (entity.id ?? "");
    if (touched.has(key)) throw Error("AI 对同一记录生成了多份操作，请合并后重试。");
    touched.add(key);
  }
  return {
    ...reply,
    actions,
    drafts: [],
    partTime: [],
    reminders: [],
    watches: [],
    directory: [],
    profile: null,
    scan: null,
    completeCompanies: null,
    enrichment: null,
  };
}
