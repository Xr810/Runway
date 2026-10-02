import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { completeCompanies, completionState, completionRunning } from "@/lib/company-complete";
import { aiConfigured } from "@/lib/ai-client";
import { boundedJson, integrationJson as json, integrationFailure } from "@/lib/integration-http";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  try { return json(await completionState()); } catch (e) { return integrationFailure(e); }
}
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    const parsed = z.object({ names: z.array(z.string().max(2000)).max(50).optional(), refreshLogo: z.boolean().default(false) }).safeParse(await boundedJson(request, 65536));
    if (!parsed.success) return json({ error: "请求格式无效" }, 400);
    if (!await aiConfigured()) return json({ error: "补全公司资料需要先在设置里配置 AI 模型" }, 503);
    if (await completionRunning()) return json({ error: "已有公司资料任务正在运行，请等它结束后重试。" }, 409);
    void completeCompanies({ names: parsed.data.names, force: true, refreshLogo: parsed.data.refreshLogo, limit: 20 }).catch(e => console.error("Company completion failed", e));
    return json({ started: true, runId: (await completionState()).run?.id });
  } catch (e) { return integrationFailure(e); }
}
