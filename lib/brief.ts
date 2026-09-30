import { briefSchema, type Brief } from "./brief-contract";
export { briefSchema, type Brief } from "./brief-contract";
import { pool } from "./postgres";
import { closed, dayDiff, today } from "./model";
import { timelineEvents } from "./journey";
import { listEntries } from "./entries";
import { listReminders } from "./reminders";
import { evaluationProfile } from "./enrichment";
import { aiJson } from "./ai-client";

export async function cachedBrief(day = today()): Promise<Brief | null> {
  const row = (await pool.query("SELECT value, created FROM ai_cache WHERE key=$1", ["brief:" + day])).rows[0];
  return row ? { ...row.value, day, created: row.created } : null;
}
/** A short plan for today, grounded only in the user's own records. */
export async function generateBrief(day = today()): Promise<Brief> {
  const [entries, reminders, profile, notices] = await Promise.all([listEntries(), listReminders(day), evaluationProfile(),
    pool.query("SELECT title, organization, summary, created FROM notifications WHERE created > now() - interval '2 days' ORDER BY seq DESC LIMIT 8")]);
  const open = entries.filter(e => !closed(e));
  const events = timelineEvents(open).filter(e => dayDiff(e.date) >= 0 && dayDiff(e.date) <= 7).map(e => `${e.date} ${e.time} ${e.label}：${e.entry.title}（${e.entry.organization || e.entry.kind}）[${e.entry.id}]`);
  const overdue = open.filter(e => e.followUp && dayDiff(e.followUp) < 0).map(e => `跟进逾期 ${-dayDiff(e.followUp)} 天：${e.title}（${e.organization}）[${e.id}] 下一步：${e.nextAction || "未写"}`);
  const waiting = open.filter(e => e.kind === "job" && e.status === "已投递" && e.applied && dayDiff(e.applied) <= -14).map(e => `投递 ${-dayDiff(e.applied)} 天未回复：${e.title}（${e.organization}）[${e.id}]`);
  const projects = open.filter(e => e.kind !== "job").map(e => { const last = e.progress.map(p => p.date).sort().at(-1); return `${e.kind === "project" ? "项目" : "比赛"}：${e.title} [${e.id}] 状态${e.status}，${last ? `上次推进 ${-dayDiff(last)} 天前` : "还没有进度"}${e.nextAction ? "，下一步：" + e.nextAction : ""}`; });
  const todo = open.filter(e => e.kind === "job" && e.status === "待投递").slice(0, 10).map(e => `待投递：${e.title}（${e.organization}）[${e.id}]${e.deadline ? " 截止 " + e.deadline : ""}`);
  const result = await aiJson("daily-brief", `你是用户的求职与项目教练，根据下面的记录给出今天最值得做的 3–5 件事。每条是一个具体行动（动词开头，40 字以内），有对应记录时附上 entryId（方括号里的 ID），没有就 null。
紧急（今明两天截止、面试、逾期）的 priority=high。不要编造记录里没有的事实。headline 用一句话概括今天的重点（30 字以内）。输出 {"headline","items":[{"text","entryId","priority"}]}`,
    [`今天：${day}（新加坡时间）`, profile.targets.length ? "期待方向：" + profile.targets.join("、") : "", "今天的提醒：\n" + (reminders.today.map(r => `${r.schedule.time || "全天"} ${r.title}${r.done ? "（已完成）" : ""}`).join("\n") || "无"),
      "未来 7 天：\n" + (events.join("\n") || "无"), "需要处理：\n" + ([...overdue, ...waiting].join("\n") || "无"), "项目与比赛：\n" + (projects.join("\n") || "无"), todo.join("\n"),
      "最近更新：\n" + (notices.rows.map(n => `${n.organization} ${n.title}：${n.summary}`).join("\n") || "无")].filter(Boolean).join("\n\n"),
    briefSchema, { maxTokens: 1200 });
  const ids = new Set(entries.map(e => e.id));
  const value = { ...result, items: result.items.map(i => ({ ...i, entryId: i.entryId && ids.has(i.entryId) ? i.entryId : null })) };
  const created = new Date().toISOString();
  await pool.query("INSERT INTO ai_cache(key,value,created) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, created=EXCLUDED.created", ["brief:" + day, JSON.stringify(value), created]);
  return { ...value, day, created };
}
