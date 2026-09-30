import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { boundedJson, integrationJson as json, integrationFailure } from "@/lib/integration-http";
import { GigError, listGigs, saveGig } from "@/lib/part-time";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!await getUser()) return json({ error: "请先登录" }, 401);
    return json({ items: await listGigs() });
  } catch (e) { return integrationFailure(e); }
}
export async function POST(request: Request) {
  try {
    if (!await getUser()) return json({ error: "请先登录" }, 401);
    if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
    return json({ item: await saveGig(await boundedJson(request, 1024 * 1024), new URL(request.url).searchParams.get("restore") === "1") });
  } catch (e) {
    if (e instanceof GigError) return json({ error: e.message }, e.status);
    return integrationFailure(e);
  }
}
