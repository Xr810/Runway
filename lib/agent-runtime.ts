import type { AgentDraft } from "./agent-contract";
import { Command } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { pool } from "./postgres";
import { createRunwayGraph } from "./agent-graph";
import { executeAgentDraft } from "./agent-executor";
import { aiRequestSchema, type AiReply } from "./ai-contract";
import { askAi, readLinks, readWebSearch } from "./ai-provider";
import { getAiConfig } from "./ai-config";
import { listEntries } from "./entries";
import { listReminders } from "./reminders";
import { listGigs } from "./part-time";
import { allWatches } from "./watch-storage";
import { evaluationProfile } from "./enrichment";
import { loadAgentSnapshot, readAgentData } from "./agent-context";
import { centralizeReply } from "./agent-legacy";
import { routeCompanyLogoCompletion } from "./agent-intents";
import type { AgentDecision, AgentRunReply, AgentOutcome } from "./agent-runtime-contract";
import { agentCheckpointConfig } from "./agent-checkpoint";
import type { z } from "zod";

export class AgentRunError extends Error { constructor(public status: number, message: string) { super(message); } }
const saver = new PostgresSaver(pool, undefined, { schema: "runway_agent" });
let ready: Promise<void> | undefined;
async function ensureCheckpoint() {
  ready ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(28402031)");
      await saver.setup();
    } finally { await client.query("SELECT pg_advisory_unlock(28402031)").catch(() => {}); client.release(); }
  })().catch(e => { ready = undefined; throw e; });
  await ready;
}
function graph(signal?: AbortSignal) {
  return createRunwayGraph(saver, {
    async plan(runId) {
      const row = (await pool.query("SELECT input FROM agent_runs WHERE id=$1", [runId])).rows[0];
      const input = aiRequestSchema.parse(row.input), settings = await getAiConfig();
      const [entries, reminders, gigs, watches, profile, pages, search] = await Promise.all([listEntries(), listReminders(), listGigs(), allWatches(), evaluationProfile(), readLinks(input.messages.at(-1)!.text, signal), readWebSearch(input.messages.at(-1)!.text, settings.tavilyKey, signal)]);
      const snapshot = await loadAgentSnapshot({ entries, reminders: reminders.reminders, gigs, watches, profile, ai: { base: settings.base, model: settings.model, revision: settings.revision } });
      const reply = await askAi(input, entries, { agent: snapshot, read: r => readAgentData(r, snapshot), reminders: snapshot.reminders, gigs, watches, profile, pages: [...pages, ...search.pages], search }, signal, settings);
      return centralizeReply(routeCompanyLogoCompletion(reply, snapshot, input.messages.at(-1)!.text), snapshot);
    },
    async execute(runId, draft, decision) {
      const row = (await pool.query("SELECT input FROM agent_runs WHERE id=$1", [runId])).rows[0];
      return executeAgentDraft(runId, draft, decision, aiRequestSchema.parse(row.input).images);
    },
  });
}
async function ownedRun(id: string, owner: string) {
  const row = (await pool.query("SELECT id,status,version,error,created FROM agent_runs WHERE id=$1 AND owner_id=$2", [id, owner])).rows[0];
  if (!row) throw new AgentRunError(404, "运行不存在。");
  if (row.version !== 1) throw new AgentRunError(409, "此运行属于其他版本，请重新提案。");
  return row;
}
async function withRunLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect(); let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS ok", [id])).rows[0].ok;
    if (!locked) throw new AgentRunError(409, "本次运行正在处理中，请稍后刷新状态。");
    return await work();
  } finally { if (locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 1))", [id]).catch(() => {}); client.release(); }
}
const emptyReply: AiReply = { reply: "", model: "", actions: [], drafts: [], partTime: [], filter: null, matchCount: null, matchIds: null, enrichment: null, reminders: [], watches: [], directory: [], profile: null, scan: null, completeCompanies: null, pages: [] };
export async function getAgentRun(id: string, owner: string): Promise<AgentRunReply> {
  const row = await ownedRun(id, owner); await ensureCheckpoint();
  const state = await graph().getState(agentCheckpointConfig(id, owner));
  const outcomes: Record<string, AgentOutcome> = { ...state.values.outcomes ?? {} };
  const receipts = await pool.query("SELECT id,result FROM agent_operations WHERE run_id=$1", [id]);
  for (const receipt of receipts.rows) outcomes[receipt.id] = receipt.result;
  const jobs = await pool.query("SELECT id,status,result,error FROM agent_jobs WHERE run_id=$1", [id]);
  for (const j of jobs.rows) if (outcomes[j.id]) { const result = j.result as { updated?: number } | null; const noUpdates = j.status === "completed" && result !== null && typeof result.updated === "number" && result.updated === 0; outcomes[j.id] = { status: j.status === "completed" ? "done" : ["failed", "interrupted"].includes(j.status) ? "error" : "queued", result: j.result, message: j.status === "completed" ? (noUpdates ? "后台任务已完成，但没有找到可更新的资料。" : "后台任务已完成。") : j.error || (j.status === "running" ? "后台任务执行中。" : "后台任务等待执行。") }; }
  const runStatus = state.values.reply ? state.next.includes("execute") ? "recoverable" : state.next.length ? "awaiting_confirmation" : "completed" : row.status;
  return { ...emptyReply, ...state.values.reply, runId: id, runtime: "langgraph", runStatus, outcomes, runError: row.error || undefined };
}
export async function listAgentRuns(owner: string) {
  const rows = await pool.query("SELECT id,status,error,created,updated,input->'messages'->-1->>'text' AS prompt FROM agent_runs WHERE owner_id=$1 ORDER BY created DESC LIMIT 12", [owner]);
  return rows.rows;
}
export async function startAgentRun(id: string, owner: string, input: z.infer<typeof aiRequestSchema>, signal?: AbortSignal) {
  await ensureCheckpoint();
  await pool.query("INSERT INTO agent_runs(id,owner_id,input) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", [id, owner, JSON.stringify(input)]);
  return advanceAgentRun(id, owner, undefined, signal);
}
export async function advanceAgentRun(id: string, owner: string, decision?: AgentDecision, signal?: AbortSignal) {
  if ((await getAiConfig()).enabled === false) throw new AgentRunError(403, "此账户未启用 AI。");
  return withRunLock(id, async () => {
    const row = await ownedRun(id, owner); await ensureCheckpoint();
    if (Date.now() - Date.parse(row.created) > 7 * 86400000) throw new AgentRunError(409, "提案已超过7天，请重新读取并生成提案。");
    const g = graph(signal), threadConfig = agentCheckpointConfig(id, owner), state = await g.getState(threadConfig);
    if (decision) {
      if (!state.values.reply?.actions?.some((a: AgentDraft) => a.id === decision.proposalId)) throw new AgentRunError(400, "提案不属于本次运行。");
      if (state.values.outcomes?.[decision.proposalId]) return getAgentRun(id, owner);
      const draft = state.values.reply.actions.find((a: AgentDraft) => a.id === decision.proposalId)!;
      if (decision.approved && draft.warnings?.length && !decision.allowDuplicate) throw new AgentRunError(400, "请先核对可能重复的记录。");
    }
    if (!state.next.length && state.values.reply || !decision && state.next.includes("approval")) return getAgentRun(id, owner);
    await pool.query("UPDATE agent_runs SET status='running',error='',updated=now() WHERE id=$1", [id]);
    try {
      if (!state.values.runId) await g.invoke({ runId: id }, threadConfig);
      else if (state.next.includes("approval")) {
        if (!decision) return getAgentRun(id, owner);
        await g.invoke(new Command({ resume: decision }), threadConfig);
      } else await g.invoke(null, threadConfig); // Replays a saved execute node; its receipt makes writes idempotent.
      const next = await g.getState(threadConfig);
      await pool.query("UPDATE agent_runs SET status=$2,error='',updated=now() WHERE id=$1", [id, next.next.length ? "awaiting_confirmation" : "completed"]);
    } catch (e) {
      const message = (e as Error).message.slice(0, 1500);
      await pool.query("UPDATE agent_runs SET status='error',error=$2,updated=now() WHERE id=$1", [id, message]);
      throw new AgentRunError(503, message);
    }
    return getAgentRun(id, owner);
  });
}
