import { briefSchema, type Brief } from "./brief-contract";
export { briefSchema, type Brief } from "./brief-contract";
import { createHash } from "node:crypto";
import { pool } from "./postgres";
import { closed, today } from "./model";
import { timelineEvents } from "./journey";
import { listEntries } from "./entries";
import { listReminders } from "./reminders";
import { evaluationProfile } from "./enrichment";
import { aiJson } from "./ai-client";
import { getAiConfig, isAiConfigured } from "./ai-config";
import { getReminderPreferences } from "./reminder-preferences";
import { recruitingReminders } from "./recruiting-reminders";

const notificationSql =
  "SELECT title, organization, summary, created FROM notifications WHERE created > now() - interval '2 days' ORDER BY seq DESC LIMIT 8";
const dateDiff = (value: string, day: string) =>
  Math.round((Date.parse(value + "T00:00:00Z") - Date.parse(day + "T00:00:00Z")) / 86400000);
const canonical = (value: unknown): unknown =>
  value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : value;
const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

async function inputs(day: string) {
  const [entries, reminders, profile, notices, preferences, ai] = await Promise.all([
    listEntries(),
    listReminders(day),
    evaluationProfile(),
    pool.query(notificationSql),
    getReminderPreferences(),
    getAiConfig(),
  ]);
  const aiPolicy = {
    enabled: ai.enabled !== false,
    mode: ai.mode ?? "personal",
    source: ai.source,
    revision: ai.revision,
    base: ai.base,
    model: ai.model,
    configured: isAiConfigured(ai),
  };
  return {
    entries,
    reminders,
    profile,
    notices: notices.rows,
    preferences,
    ai,
    fingerprint: fingerprint({
      day,
      entries,
      reminders,
      profile,
      notifications: notices.rows,
      preferences,
      ai: aiPolicy,
    }),
  };
}

export async function cachedBrief(day = today()): Promise<Brief | null> {
  const current = await inputs(day);
  const row = (
    await pool.query("SELECT value, created FROM ai_cache WHERE key=$1", ["brief:" + day])
  ).rows[0];
  if (!row || row.value.inputFingerprint !== current.fingerprint) return null;
  return { ...briefSchema.parse(row.value), day, created: row.created };
}
/** A short plan for today, grounded only in the user's own records. */
export async function generateBrief(day = today()): Promise<Brief> {
  const {
    entries,
    reminders,
    profile,
    notices,
    preferences,
    ai,
    fingerprint: inputFingerprint,
  } = await inputs(day);
  const open = entries.filter((e) => !closed(e));
  const upcoming = timelineEvents(open, preferences).filter(
    (e) => dateDiff(e.date, day) >= 0 && dateDiff(e.date, day) <= 7,
  );
  const events = upcoming.map(
    (e) =>
      `${e.date} ${e.time} ${e.label}：${e.entry.title}（${e.entry.organization || e.entry.kind}）[${e.entry.id}]`,
  );
  const overdueEntries = open.filter(
    (e) => e.kind !== "job" && e.followUp && dateDiff(e.followUp, day) < 0,
  );
  const overdue = overdueEntries.map(
    (e) =>
      `跟进逾期 ${-dateDiff(e.followUp, day)} 天：${e.title}（${e.organization}）[${e.id}] 下一步：${e.nextAction || "未写"}`,
  );
  const waitingReminders = recruitingReminders(open, preferences).filter(
    (reminder) => reminder.date <= day,
  );
  const waiting = waitingReminders.map(
    (reminder) => `${reminder.date} ${reminder.title} [${reminder.entryId}]`,
  );
  const projects = open
    .filter((e) => e.kind !== "job")
    .map((e) => {
      const last = e.progress
        .map((p) => p.date)
        .sort()
        .at(-1);
      return `${e.kind === "project" ? "项目" : "比赛"}：${e.title} [${e.id}] 状态${e.status}，${last ? `上次推进 ${-dateDiff(last, day)} 天前` : "还没有进度"}${e.nextAction ? "，下一步：" + e.nextAction : ""}`;
    });
  const todo = open
    .filter((e) => e.kind === "job" && e.status === "待投递")
    .slice(0, 10)
    .map(
      (e) =>
        `待投递：${e.title}（${e.organization}）[${e.id}]${e.deadline ? " 截止 " + e.deadline : ""}`,
    );
  const fallback = () =>
    briefSchema.parse({
      headline: "优先处理临近安排和待跟进事项",
      items: [
        ...reminders.today
          .filter((r) => !r.done)
          .map((r) => ({
            text: `完成提醒：${r.title}`,
            entryId: r.entryId,
            priority: "high" as const,
          })),
        ...overdueEntries.map((e) => ({
          text: e.nextAction || `跟进${e.title}`,
          entryId: e.id,
          priority: "high" as const,
        })),
        ...waitingReminders.map((r) => ({
          text:
            (r.source === "manual" && open.find((e) => e.id === r.entryId)?.nextAction) || r.title,
          entryId: r.entryId,
          priority: "high" as const,
        })),
        ...upcoming.map((e) => ({
          text: `准备${e.label}：${e.entry.title}`,
          entryId: e.entry.id,
          priority: dateDiff(e.date, day) <= 1 ? ("high" as const) : ("normal" as const),
        })),
        ...open
          .filter((e) => e.kind === "job" && e.status === "待投递")
          .map((e) => ({
            text: `准备并投递${e.title}`,
            entryId: e.id,
            priority: "normal" as const,
          })),
        ...open
          .filter((e) => e.kind !== "job")
          .map((e) => ({
            text: e.nextAction || `推进${e.title}`,
            entryId: e.id,
            priority: "normal" as const,
          })),
      ].slice(0, 5),
    });
  let result;
  try {
    result = aiPolicyConfigured(ai)
      ? await aiJson(
          "daily-brief",
          `你是用户的求职与项目教练，根据下面的记录给出今天最值得做的 3–5 件事。每条是一个具体行动（动词开头，40 字以内），有对应记录时附上 entryId（方括号里的 ID），没有就 null。
紧急（今明两天截止、面试、逾期）的 priority=high。不要编造记录里没有的事实。headline 用一句话概括今天的重点（30 字以内）。输出 {"headline","items":[{"text","entryId","priority"}]}`,
          [
            `日期：${day}`,
            profile.targets.length ? "期待方向：" + profile.targets.join("、") : "",
            "今天的提醒：\n" +
              (reminders.today
                .map((r) => `${r.schedule.time || "全天"} ${r.title}${r.done ? "（已完成）" : ""}`)
                .join("\n") || "无"),
            "未来 7 天：\n" + (events.join("\n") || "无"),
            "需要处理：\n" + ([...overdue, ...waiting].join("\n") || "无"),
            "项目与比赛：\n" + (projects.join("\n") || "无"),
            todo.join("\n"),
            "最近更新：\n" +
              (notices.map((n) => `${n.organization} ${n.title}：${n.summary}`).join("\n") || "无"),
          ]
            .filter(Boolean)
            .join("\n\n"),
          briefSchema,
          { maxTokens: 1200 },
        )
      : fallback();
  } catch {
    result = fallback();
  }
  const ids = new Set(entries.map((e) => e.id));
  const value = {
    ...result,
    items: result.items.map((i) => ({
      ...i,
      entryId: i.entryId && ids.has(i.entryId) ? i.entryId : null,
    })),
  };
  const created = new Date().toISOString();
  await pool.query(
    "INSERT INTO ai_cache(key,value,created) VALUES($1,$2,$3) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value, created=EXCLUDED.created",
    ["brief:" + day, JSON.stringify({ ...value, inputFingerprint }), created],
  );
  return { ...value, day, created };
}

function aiPolicyConfigured(ai: Awaited<ReturnType<typeof getAiConfig>>) {
  return isAiConfigured(ai);
}
