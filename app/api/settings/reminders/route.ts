import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { getReminderPreferences, reminderPreferencesSchema, saveReminderPreferences } from "@/lib/reminder-preferences";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET() { if (!await getUser()) return json({ error: "请先登录" }, 401); return json({ preferences: await getReminderPreferences() }); }
export async function PUT(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "请求格式无效" }, 400); }
  const parsed = reminderPreferencesSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "设置无效" }, 400);
  try { return json({ preferences: await saveReminderPreferences(parsed.data) }); }
  catch (error) { console.error("Failed to save reminder preferences", error); return json({ error: "设置暂时不可用，请稍后重试" }, 503); }
}
