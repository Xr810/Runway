import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { hit } from "@/lib/rate-limit";
import { aiRequestSchema, validImageData } from "@/lib/ai-contract";
import { getAiConfig, publicAiConfig } from "@/lib/ai-config";
import { agentCapabilities, agentReadModules } from "@/lib/agent-capabilities";
import { startAgentRun, listAgentRuns, AgentRunError } from "@/lib/agent-runtime";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const user = await getUser(); if (!user) return json({ error: "请先登录" }, 401);
  try {
    if (new URL(request.url).searchParams.has("runs")) return json({ runs: await listAgentRuns(user.userId) });
    const config = publicAiConfig(await getAiConfig());
    return json({ configured: config.configured, model: config.model, runtime: "langgraph", capabilities: agentCapabilities, reads: agentReadModules });
  } catch { return json({ error: "读取 AI 状态失败。" }, 503); }
}
export async function POST(request: Request) {
  const user = await getUser(); if (!user) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  let input;
  try {
    const reader = request.body?.getReader(); if (!reader) throw Error();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 11 * 1024 * 1024) { await reader.cancel(); return json({ error: "图片总量过大" }, 413); } chunks.push(value); }
    input = aiRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (input.images.some(i => !validImageData(i.dataUrl))) throw Error();
    if (!input.messages.at(-1)?.text.trim() && !input.images.length) throw Error();
  } catch { return json({ error: "消息或图片格式无效。" }, 400); }
  const runId = input.runId ?? crypto.randomUUID();
  try {
    if (!await hit("ai-chat", 60, 3600)) return json({ error: "本小时请求已达60次。" }, 429);
    return json(await startAgentRun(runId, user.userId, input, request.signal));
  } catch (e) { return json({ runId, error: e instanceof AgentRunError ? e.message : "AI 运行暂时失败，可从运行记录恢复。" }, e instanceof AgentRunError ? e.status : 503); }
}
