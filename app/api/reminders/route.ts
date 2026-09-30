import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { today } from "@/lib/model";
import { ReminderError, deleteReminder, listReminders, markReminder, saveReminder } from "@/lib/reminders";
import { boundedJson, integrationJson as json, integrationFailure } from "@/lib/integration-http";
export const dynamic = "force-dynamic";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), reminder: z.unknown() }),
  z.object({ action: z.literal("delete"), id: z.string().max(100) }),
  z.object({ action: z.literal("done"), id: z.string().max(100), day, done: z.boolean() }),
]);
export async function GET(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  const requested = new URL(request.url).searchParams.get("day");
  if (requested && !day.safeParse(requested).success) return json({ error: "日期无效" }, 400);
  try { return json(await listReminders(requested || today())); } catch (e) { return integrationFailure(e); }
}
export async function POST(request: Request) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (!validOrigin(request)) return json({ error: "请求来源无效" }, 403);
  try {
    const parsed = actions.safeParse(await boundedJson(request, 32768)); if (!parsed.success) return json({ error: "请求格式无效" }, 400);
    const input = parsed.data;
    if (input.action === "save") return json({ reminder: await saveReminder(input.reminder) });
    if (input.action === "delete") await deleteReminder(input.id); else await markReminder(input.id, input.day, input.done);
    return json({ ok: true });
  } catch (e) { if (e instanceof ReminderError) return json({ error: e.message }, e.status); return integrationFailure(e); }
}
