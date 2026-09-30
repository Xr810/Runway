import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)), "日期无效");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式为 HH:MM").or(z.literal(""));
export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("once"), date, time: time.default("") }).strict(),
  z.object({ type: z.literal("daily"), time: time.default(""), until: date.or(z.literal("")).default("") }).strict(),
  // days: 1 = Monday … 7 = Sunday.
  z.object({ type: z.literal("weekly"), days: z.array(z.number().int().min(1).max(7)).min(1).max(7), time: time.default(""), until: date.or(z.literal("")).default("") }).strict(),
]);
export const reminderSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), title: z.string().trim().min(1, "请填写提醒内容").max(300), note: z.string().max(4000).default(""),
  url: z.string().max(2000).refine(v => !v || URL.canParse(v) && /^https?:\/\//i.test(v), "链接无效").default(""),
  schedule: scheduleSchema, active: z.boolean().default(true), entryId: z.string().max(100).nullable().default(null),
  source: z.enum(["user", "ai"]).default("user"), revision: z.number().int().min(0).default(0),
}).strict();
/** UI list items include derived fields; accept and discard them at save boundaries. */
export const reminderSaveSchema = reminderSchema.extend({
  description: z.string().optional(), done: z.boolean().optional(),
}).transform(value => {
  const reminder = { ...value };
  delete reminder.description;
  delete reminder.done;
  return reminder;
});
export type Reminder = z.infer<typeof reminderSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;

const isoWeekday = (day: string) => ((new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7) + 1;
export function occursOn(schedule: Schedule, day: string) {
  if (schedule.type === "once") return schedule.date === day;
  if (schedule.until && day > schedule.until) return false;
  return schedule.type === "daily" || schedule.days.includes(isoWeekday(day));
}
const dayNames = ["", "一", "二", "三", "四", "五", "六", "日"];
export function describeSchedule(s: Schedule) {
  const at = s.time ? " " + s.time : "";
  if (s.type === "once") return s.date + at;
  const until = s.until ? `，到 ${s.until}` : "";
  if (s.type === "daily") return "每天" + at + until;
  const days = [...s.days].sort();
  const label = days.join() === "1,2,3,4,5" ? "工作日" : days.join() === "6,7" ? "周末" : "每周" + days.map(d => dayNames[d]).join("、");
  return label + at + until;
}
