import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { getAgentRun, advanceAgentRun, AgentRunError } from "@/lib/agent-runtime";
import { agentDecisionSchema } from "@/lib/agent-runtime-contract";
import { boundedJson } from "@/lib/integration-http";
import { runAgentJobs } from "@/lib/agent-jobs";
import { hit } from "@/lib/rate-limit";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
function failure(e: unknown) { return json({ error: e instanceof AgentRunError ? e.message : "运行状态不可用，请稍后重试。" }, e instanceof AgentRunError ? e.status : 503); }
export async function GET(_request: Request, context: Context) {
  const user = await getUser(); if (!user) return json({ error: "请先登录" }, 401);
  const parsed = z.string().uuid().safeParse((await context.params).id); if (!parsed.success) return json({ error: "运行ID无效" }, 400);
  try { return json(await getAgentRun(parsed.data, user.userId)); } catch (e) { return failure(e); }
}
export async function POST(request: Request, context: Context) {
  const user = await getUser(); if (!user) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  const id = z.string().uuid().safeParse((await context.params).id); if (!id.success) return json({ error: "运行ID无效" }, 400);
  const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("decide"), decision: agentDecisionSchema }).strict(), z.object({ action: z.literal("recover") }).strict()]);
  let body; try { body = schema.parse(await boundedJson(request, 4096)); } catch { return json({ error: "确认格式无效。" }, 400); }
  try {
    if (!await hit("ai-run-actions", 180, 3600)) return json({ error: "操作过于频繁。" }, 429);
    const result = await advanceAgentRun(id.data, user.userId, body.action === "decide" ? body.decision : undefined, request.signal);
    void runAgentJobs().catch(e => console.error("Agent worker failed", (e as Error).name));
    return json(result);
  } catch (e) { return failure(e); }
}
