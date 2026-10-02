import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { getReminderPreferences, saveReminderPreferences } from "@/lib/reminder-preferences";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() { if (!await getUser()) return json({ error: "请先登录" }, 401); return json({ preferences: await getReminderPreferences() }); }
export async function PUT(request: Request) { if (!await getUser()) return json({ error: "请先登录" }, 401); if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403); try { return json({ preferences: await saveReminderPreferences(await request.json()) }); } catch (error) { return json({ error: error instanceof Error ? error.message : "设置无效" }, 400); } }
