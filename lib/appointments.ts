import { z } from "zod";

export const RECRUITING_TIME_ZONE = "Asia/Hong_Kong";
export const DEFAULT_ASSESSMENT_PLAN_DAYS = 3;
const calendarDate = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value),
    "日期无效",
  )
  .default("");
const instant = z.string().datetime({ offset: true });

export const appointmentSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    title: z.string().trim().min(1).max(300),
    type: z.enum(["interview", "assessment", "followup"]),
    startsAt: instant.or(z.literal("")),
    endsAt: instant.optional(),
    location: z.string().max(2000).default(""),
    url: z
      .string()
      .max(4000)
      .refine(
        (value) => !value || (URL.canParse(value) && /^https?:\/\//i.test(value)),
        "日程链接无效",
      )
      .default(""),
    status: z.enum(["scheduled", "completed", "cancelled"]).default("scheduled"),
    receivedDate: calendarDate,
    deadlineDate: calendarDate,
    completedAt: instant.or(z.literal("")).default(""),
    response: z.enum(["pending", "advanced", "rejected"]).default("pending"),
    stageState: z.enum(["current", "superseded"]).default("current"),
    reminderDays: z.number().int().min(0).max(90).nullable().default(null),
    remindersEnabled: z.boolean().nullable().default(null),
    reminderBase: z.enum(["completion", "deadline"]).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.endsAt && Date.parse(value.endsAt) <= Date.parse(value.startsAt))
      issue("结束时间必须晚于开始时间");
    if (
      value.receivedDate &&
      value.startsAt &&
      appointmentDate(value.startsAt) < value.receivedDate
    )
      issue("阶段日期不能早于收到通知日期");
    if (
      value.type === "assessment" &&
      value.deadlineDate &&
      value.receivedDate &&
      value.deadlineDate < value.receivedDate
    )
      issue("测评截止日期不能早于收到日期");
    if (value.status === "completed" && !value.completedAt)
      issue(
        value.type === "interview"
          ? "已参加面试必须填写确认时间"
          : "已完成阶段必须填写实际完成时间",
      );
    if (value.completedAt && Date.parse(value.completedAt) > Date.now())
      issue("完成或确认时间不能在未来");
    if (
      value.completedAt &&
      value.receivedDate &&
      appointmentDate(value.completedAt) < value.receivedDate
    )
      issue("完成日期不能早于收到通知日期");
    if (value.type === "interview" && value.status === "completed" && !value.startsAt)
      issue("确认参加前请填写面试时间");
    if (
      value.type === "interview" &&
      value.completedAt &&
      Date.parse(value.completedAt) < Date.parse(value.startsAt)
    )
      issue("面试不能在预约时间前确认参加");
    if (value.status !== "completed" && value.completedAt)
      issue("只有已完成或已参加阶段才能填写完成时间");
    if (value.type !== "assessment" && value.reminderBase) issue("只有测评可选择提醒日期基准");
  });
export type Appointment = z.infer<typeof appointmentSchema>;

/** Older records predate `stageState`, so every stage defaults to `current` and the
 * entry schema rejects the whole record. Keep only the newest stage active (#26). */
export function normalizeStageStates(items: Appointment[]): Appointment[] {
  const current = items.filter((item) => item.type !== "followup" && item.stageState === "current");
  if (current.length <= 1) return items;
  const keep = current[current.length - 1].id;
  return items.map((item) =>
    item.stageState === "current" && item.id !== keep
      ? { ...item, stageState: "superseded" as const }
      : item,
  );
}

export const appointmentDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: RECRUITING_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value))
    : "";
export const appointmentTime = (value: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: RECRUITING_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "";
export function addCalendarDays(date: string, days: number) {
  const value = new Date(date + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
/** A fallback is an application plan, never a company deadline or persisted fact. */
export const stageDueDate = (item: Appointment, planDays = DEFAULT_ASSESSMENT_PLAN_DAYS) =>
  item.type === "assessment"
    ? item.deadlineDate || (item.receivedDate ? addCalendarDays(item.receivedDate, planDays) : "")
    : appointmentDate(item.startsAt);

export function stageProgress(
  item: Appointment,
  day: string,
  reminderDate?: string,
  planDays = DEFAULT_ASSESSMENT_PLAN_DAYS,
) {
  if (item.status === "cancelled")
    return { state: "inactive" as const, percent: 100, label: "已取消 / 未参加" };
  if (item.response === "advanced")
    return { state: "advanced" as const, percent: 100, label: "已进入下一阶段" };
  if (item.response === "rejected")
    return { state: "rejected" as const, percent: 100, label: "未通过" };
  if (item.stageState === "superseded")
    return { state: "inactive" as const, percent: 100, label: "已结束" };
  if (item.status === "completed") {
    const base =
      item.type === "interview"
        ? appointmentDate(item.startsAt)
        : appointmentDate(item.completedAt);
    const end = reminderDate || "";
    return {
      state: "waiting" as const,
      percent: datePercent(base, end, day),
      label: reminderDate ? `等待反馈 · ${reminderDate} 跟进` : "已完成，等待反馈",
    };
  }
  const start = item.receivedDate,
    end = stageDueDate(item, planDays);
  return {
    state: "pending" as const,
    percent: datePercent(start, end, day),
    label: item.type === "assessment" ? "待完成测评" : "等待面试",
  };
}
function datePercent(start: string, end: string, day: string) {
  if (!start || !end) return 0;
  const total = Math.max(1, Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z"));
  const elapsed = Math.max(0, Date.parse(day + "T00:00:00Z") - Date.parse(start + "T00:00:00Z"));
  return Math.min(100, Math.round((elapsed / total) * 100));
}
