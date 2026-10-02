import { pool } from "./postgres";
import { reminderPreferencesSchema } from "./recruiting-reminders";
export { defaultReminderPreferences, reminderPreferencesSchema, recruitingReminders } from "./recruiting-reminders";
export type { ReminderPreferences, RecruitingReminder } from "./recruiting-reminders";
const key = "recruiting-reminders-v1";
export async function getReminderPreferences() { const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [key])).rows[0]; return reminderPreferencesSchema.parse(row ? JSON.parse(row.value) : {}); }
export async function saveReminderPreferences(input: unknown) { const value = reminderPreferencesSchema.parse(input); await pool.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value", [key, JSON.stringify(value)]); return value; }
