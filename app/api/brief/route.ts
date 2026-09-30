import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { cachedBrief, generateBrief } from "@/lib/brief";
import { aiConfigured, AiUnavailable } from "@/lib/ai-client";
import { hit } from "@/lib/rate-limit";
import { integrationJson as json } from "@/lib/integration-http";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  try { return json({ brief: await cachedBrief(), configured: await aiConfigured() }); } catch (e) { console.error(e); return json({ error: "读取失败" }, 503); }
}
/** Generates (or regenerates) today's brief. */
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  if (!await hit("ai-brief", 20, 3600)) return json({ error: "刷新太频繁，请稍后再试" }, 429);
  try { return json({ brief: await generateBrief() }); }
  catch (e) { return json({ error: e instanceof AiUnavailable ? e.message : "生成失败：" + (e as Error).message }, e instanceof AiUnavailable ? 503 : 502); }
}
