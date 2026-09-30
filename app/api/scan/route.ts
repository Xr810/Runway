import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { recentRuns, runScan, saveScanSettings, scanOverview } from "@/lib/scanner";
import { aiConfigured } from "@/lib/ai-client";
import { boundedJson, integrationJson as json, integrationFailure } from "@/lib/integration-http";
export const dynamic = "force-dynamic";
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), watchIds: z.array(z.string().max(100)).max(100).optional() }),
  z.object({ action: z.literal("settings"), settings: z.unknown() }),
]);
export async function GET(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  try { const history = new URL(request.url).searchParams.has("history"); return json({ ...await scanOverview(), configured: await aiConfigured(), ...(history ? { runs: await recentRuns() } : {}) }); }
  catch (e) { return integrationFailure(e); }
}
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    const parsed = actions.safeParse(await boundedJson(request, 16384)); if (!parsed.success) return json({ error: "请求格式无效" }, 400);
    if (parsed.data.action === "settings") return json({ settings: await saveScanSettings(parsed.data.settings) });
    if (!await aiConfigured()) return json({ error: "自动扫描需要先在设置里配置 AI 模型" }, 503);
    // Scans take minutes; the client polls GET for progress.
    void runScan("manual", parsed.data.watchIds).catch(e => console.error("Scan failed", e));
    return json({ started: true });
  } catch (e) { return integrationFailure(e); }
}
