import { z } from "zod";
import { addCalendarDays, appointmentDate, type Appointment } from "./appointments";
import type { Entry } from "./model";

const preference = z.object({ enabled: z.boolean(), days: z.number().int().min(0).max(90) });
export const reminderPreferencesSchema = z.object({
  application: preference.default({ enabled: true, days: 14 }),
  assessment: preference.extend({ reminderBase: z.enum(["completion", "deadline"]).default("completion") }).default({ enabled: true, days: 7, reminderBase: "completion" }),
  interview: preference.default({ enabled: true, days: 7 }),
}).default({ application: { enabled: true, days: 14 }, assessment: { enabled: true, days: 7, reminderBase: "completion" }, interview: { enabled: true, days: 7 } });
export type ReminderPreferences = z.infer<typeof reminderPreferencesSchema>;
export const defaultReminderPreferences: ReminderPreferences = reminderPreferencesSchema.parse({});
export type RecruitingReminder = { id: string; entryId: string; appointmentId: string | null; date: string; kind: "application" | "assessment" | "interview"; title: string };
const terminal = new Set(["Offer", "未通过", "放弃", "已结束", "已完成", "已放弃"]);

/** Pure, deterministic follow-up calculation. Explicit manual follow-up replaces automatic reminders for the entry. */
export function recruitingReminders(entries: Entry[], preferences: ReminderPreferences = defaultReminderPreferences): RecruitingReminder[] {
  const result: RecruitingReminder[] = [];
  for (const entry of entries) {
    if (entry.kind !== "job" || terminal.has(entry.status) || entry.followUp) continue;
    const current = entry.appointments.filter(stage => stage.stageState === "current" && stage.status !== "cancelled");
    const enabled = entry.applicationRemindersEnabled ?? preferences.application.enabled;
    const days = entry.applicationReminderDays ?? preferences.application.days;
    if (enabled && entry.applied && current.length === 0 && entry.status === "已投递") result.push(reminder(entry, null, "application", addCalendarDays(entry.applied, days)));
    const latestStage = current.toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
    for (const stage of latestStage ? [latestStage] : []) {
      if (!isCandidate(stage)) continue;
      const pref = stage.type === "assessment" ? preferences.assessment : preferences.interview;
      if (!(stage.remindersEnabled ?? pref.enabled)) continue;
      const stageDays = stage.reminderDays ?? pref.days;
      // A late attendance confirmation never shifts an interview reminder.
      const basis = stage.type === "interview" ? appointmentDate(stage.startsAt) : (stage.reminderBase ?? preferences.assessment.reminderBase) === "deadline" ? stage.deadlineDate : appointmentDate(stage.completedAt);
      if (basis) result.push(reminder(entry, stage, stage.type as "assessment" | "interview", addCalendarDays(basis, stageDays)));
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
function reminder(entry: Entry, stage: Appointment | null, kind: RecruitingReminder["kind"], date: string): RecruitingReminder { return { id: stage ? `stage:${entry.id}:${stage.id}` : `application:${entry.id}`, entryId: entry.id, appointmentId: stage?.id ?? null, date, kind, title: `跟进 ${entry.title} ${kind === "application" ? "的申请" : kind === "assessment" ? "测评反馈" : "面试反馈"}` }; }
function isCandidate(stage: Appointment) { return (stage.type === "assessment" || stage.type === "interview") && stage.status === "completed" && !!stage.completedAt && stage.response === "pending"; }
