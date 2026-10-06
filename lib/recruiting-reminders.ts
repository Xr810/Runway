import { z } from "zod";
import {
  addCalendarDays,
  appointmentDate,
  DEFAULT_ASSESSMENT_PLAN_DAYS,
  type Appointment,
} from "./appointments";
import type { Entry } from "./model";

const preference = z.object({ enabled: z.boolean(), days: z.number().int().min(0).max(90) });
export const reminderPreferencesSchema = z
  .object({
    application: preference.default({ enabled: true, days: 14 }),
    assessment: preference
      .extend({
        planDays: z.number().int().min(1).max(90).default(DEFAULT_ASSESSMENT_PLAN_DAYS),
        reminderBase: z.enum(["completion", "deadline"]).default("completion"),
      })
      .default({ enabled: true, days: 7, reminderBase: "completion" }),
    interview: preference.default({ enabled: true, days: 7 }),
  })
  .default({
    application: { enabled: true, days: 14 },
    assessment: { enabled: true, days: 7, reminderBase: "completion" },
    interview: { enabled: true, days: 7 },
  });
export type ReminderPreferences = z.infer<typeof reminderPreferencesSchema>;
export const defaultReminderPreferences: ReminderPreferences = reminderPreferencesSchema.parse({});
export type RecruitingReminder = {
  id: string;
  entryId: string;
  appointmentId: string | null;
  date: string;
  kind: "application" | "assessment" | "interview" | "manual";
  source: "manual" | "automatic";
  title: string;
};
const terminal = new Set(["Offer", "未通过", "放弃", "已结束", "已完成", "已放弃"]);

/** One effective date. Manual overrides remain explicit; automatic dates are never persisted. */
export function effectiveFollowUp(
  entry: Entry,
  preferences: ReminderPreferences = defaultReminderPreferences,
): RecruitingReminder | null {
  if (entry.kind !== "job") return null;
  const stages = entry.appointments.filter((stage) => stage.type !== "followup");
  const current = stages.filter((stage) => stage.stageState === "current");
  const stage = current.length === 1 && isCandidate(current[0]) ? current[0] : null;
  if (entry.followUp)
    return reminder(entry, terminal.has(entry.status) ? null : stage, "manual", entry.followUp);
  if (terminal.has(entry.status)) return null;
  if (
    !stages.length &&
    entry.status === "已投递" &&
    entry.applied &&
    (entry.applicationRemindersEnabled ?? preferences.application.enabled)
  ) {
    return reminder(
      entry,
      null,
      "application",
      addCalendarDays(entry.applied, entry.applicationReminderDays ?? preferences.application.days),
    );
  }
  if (!stage) return null;
  const pref = stage.type === "assessment" ? preferences.assessment : preferences.interview;
  if (!(stage.remindersEnabled ?? pref.enabled)) return null;
  // Late attendance confirmation never shifts an interview reminder. An application
  // plan is not a company deadline when the deadline-based feedback rule is selected.
  const basis =
    stage.type === "interview"
      ? appointmentDate(stage.startsAt)
      : (stage.reminderBase ?? preferences.assessment.reminderBase) === "deadline"
        ? stage.deadlineDate
        : appointmentDate(stage.completedAt);
  return basis
    ? reminder(
        entry,
        stage,
        stage.type as "assessment" | "interview",
        addCalendarDays(basis, stage.reminderDays ?? pref.days),
      )
    : null;
}

export function recruitingReminders(
  entries: Entry[],
  preferences: ReminderPreferences = defaultReminderPreferences,
): RecruitingReminder[] {
  return entries
    .map((entry) => effectiveFollowUp(entry, preferences))
    .filter((item): item is RecruitingReminder => item !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
function reminder(
  entry: Entry,
  stage: Appointment | null,
  kind: RecruitingReminder["kind"],
  date: string,
): RecruitingReminder {
  return {
    id:
      kind === "manual"
        ? `manual:${entry.id}`
        : stage
          ? `stage:${entry.id}:${stage.id}`
          : `application:${entry.id}`,
    entryId: entry.id,
    appointmentId: stage?.id ?? null,
    date,
    kind,
    source: kind === "manual" ? "manual" : "automatic",
    title:
      kind === "manual"
        ? `跟进 ${entry.title}（手动安排）`
        : `跟进 ${entry.title} ${kind === "application" ? "的申请" : kind === "assessment" ? "测评反馈" : "面试反馈"}`,
  };
}
function isCandidate(stage: Appointment) {
  return (
    (stage.type === "assessment" || stage.type === "interview") &&
    stage.status === "completed" &&
    !!stage.completedAt &&
    stage.response === "pending"
  );
}
