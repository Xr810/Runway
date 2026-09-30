import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { exportPersonalBackup, restorePersonalBackup } from "@/lib/backup";
import { boundedJson, integrationFailure, integrationJson as json } from "@/lib/integration-http";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  try { return json(await exportPersonalBackup()); } catch (e) { return integrationFailure(e); }
}
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try { return json(await restorePersonalBackup(await boundedJson(request, 32 * 1024 * 1024))); }
  catch (e) { if (e instanceof z.ZodError) return json({ error: e.issues[0].message }, 400); return integrationFailure(e); }
}
