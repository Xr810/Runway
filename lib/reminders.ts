import { pool, tx } from "./postgres";
import { today } from "./model";
import { describeSchedule, occursOn, reminderSaveSchema, type Reminder, type Schedule } from "./reminder-schema";
export * from "./reminder-schema";

type Row = { id: string; title: string; note: string; url: string; schedule: Schedule; active: boolean; entry_id: string | null; source: "user" | "ai"; revision: number };
const toReminder = (r: Row): Reminder => ({ id: r.id, title: r.title, note: r.note, url: r.url, schedule: r.schedule, active: r.active, entryId: r.entry_id, source: r.source, revision: r.revision });

export async function listReminders(day = today()) {
  const [rows, done] = await Promise.all([
    pool.query<Row>("SELECT * FROM reminders ORDER BY active DESC, created"),
    pool.query<{ reminder_id: string; day: string }>("SELECT reminder_id, to_char(day,'YYYY-MM-DD') AS day FROM reminder_done WHERE day >= $1::date - 7", [day]),
  ]);
  const doneSet = new Set(done.rows.map(r => r.reminder_id + ":" + r.day));
  const reminders = rows.rows.map(toReminder);
  return {
    reminders: reminders.map(r => ({ ...r, description: describeSchedule(r.schedule) })),
    today: reminders.filter(r => r.active && occursOn(r.schedule, day)).map(r => ({ ...r, description: describeSchedule(r.schedule), done: doneSet.has(r.id + ":" + day) }))
      .sort((a, b) => (a.schedule.time || "99").localeCompare(b.schedule.time || "99")),
  };
}
export class ReminderError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function saveReminder(input: unknown) {
  const parsed = reminderSaveSchema.safeParse(input); if (!parsed.success) throw new ReminderError(400, parsed.error.issues[0].message);
  const r = parsed.data;
  return tx(async client => {
    const old = (await client.query<{ revision: number }>("SELECT revision FROM reminders WHERE id=$1 FOR UPDATE", [r.id])).rows[0];
    if ((old?.revision ?? 0) !== r.revision) throw new ReminderError(409, "提醒已更新，请刷新后再试");
    if (r.entryId && !(await client.query("SELECT 1 FROM entries WHERE id=$1", [r.entryId])).rowCount) r.entryId = null;
    const revision = r.revision + 1;
    await client.query(`INSERT INTO reminders(id,title,note,url,schedule,active,entry_id,source,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,note=EXCLUDED.note,url=EXCLUDED.url,schedule=EXCLUDED.schedule,active=EXCLUDED.active,entry_id=EXCLUDED.entry_id,revision=EXCLUDED.revision,updated=now()`,
      [r.id, r.title, r.note, r.url, JSON.stringify(r.schedule), r.active, r.entryId, r.source, revision]);
    return { ...r, revision };
  });
}
export async function deleteReminder(id: string) { await pool.query("DELETE FROM reminders WHERE id=$1", [id]); }
export async function markReminder(id: string, day: string, done: boolean) {
  if (done) await pool.query("INSERT INTO reminder_done(reminder_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, day]);
  else await pool.query("DELETE FROM reminder_done WHERE reminder_id=$1 AND day=$2", [id, day]);
}
