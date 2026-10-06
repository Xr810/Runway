import { z } from "zod";
import { appointmentSchema, RECRUITING_TIME_ZONE } from "./appointments";
export const jobStatuses = [
  "待投递",
  "已投递",
  "笔试",
  "AI测评",
  "一面",
  "二面",
  "终面",
  "Offer",
  "未通过",
  "放弃",
];
export const nextActions = [
  "准备投递",
  "提交申请",
  "笔试",
  "AI测评",
  "一面",
  "二面",
  "终面",
  "跟进申请",
  "等待结果",
  "接受 Offer",
  "自定义",
];
export function defaultNextAction(status: string) {
  return (
    (
      {
        待投递: "准备投递",
        已投递: "跟进申请",
        笔试: "笔试",
        AI测评: "AI测评",
        一面: "一面",
        二面: "二面",
        终面: "终面",
        Offer: "接受 Offer",
      } as Record<string, string>
    )[status] || ""
  );
}
/**
 * Link an explicit job-status patch to its next action before merging the record.
 * An explicit nextAction (including "") wins. Re-submitting the same status still
 * applies the default; full saves/restores and creation defaults are separate.
 * Callers retain responsibility for schema validation.
 */
export function withStatusNextAction<T extends Record<string, unknown>>(
  kind: Entry["kind"],
  patch: T,
) {
  return kind === "job" && typeof patch.status === "string" && patch.nextAction === undefined
    ? { ...patch, nextAction: defaultNextAction(patch.status) }
    : patch;
}

export function normalizeLegacyNextAction(status: string, value: string) {
  const legacy =
    /无明确截止日期/.test(value) &&
    /(?:笔记|通知|邮件)/.test(value) &&
    /\d{4}-\d{2}-\d{2}/.test(value);
  return legacy ? defaultNextAction(status) || "查看通知" : "";
}
export const competitionStatuses = [
  "关注中",
  "准备报名",
  "已报名",
  "进行中",
  "已提交",
  "获奖",
  "已结束",
  "放弃",
];
export const projectStatuses = ["构思中", "进行中", "暂停", "已完成", "已放弃"];
export const statusesFor = (kind: string) =>
  kind === "job" ? jobStatuses : kind === "project" ? projectStatuses : competitionStatuses;
export const workModes = ["待核实", "现场办公", "远程 Remote", "混合 Hybrid"];
export const employmentTypes = ["待核实", "实习 Internship", "正式岗位", "合同 / 项目"];
export const schedules = ["待核实", "全职 Full-time", "兼职 Part-time"];
export const companyTypes = ["待核实", "外企", "中国内地企业", "港澳台企业"];
const option = (values: string[]) =>
  z
    .string()
    .refine((v) => values.includes(v), "无效的岗位属性")
    .default("待核实");
const short = z.string().max(2000).default("");
/** True only for a real `YYYY-MM-DD` calendar date; rejects rollovers such as 2026-02-30. */
export function validCalendarDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
const date = z
  .string()
  .refine((v) => !v || validCalendarDate(v), "日期格式无效")
  .default("");
const url = z
  .string()
  .max(4000)
  .refine(
    (v) => !v || (/^https?:\/\//i.test(v) && URL.canParse(v)),
    "链接需要以 https:// 或 http:// 开头",
  )
  .default("");
export const progressSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  date: z
    .string()
    .refine((v) => validCalendarDate(v) && v <= today(), "进度日期需为今天或过去的有效日期"),
  text: z.string().trim().min(1, "请写下本次进度").max(2000),
  minutes: z.number().int().min(0).max(1440).default(0),
  track: z.string().trim().max(120).default(""),
  milestone: z.boolean().default(false),
});
export type ProgressLog = z.infer<typeof progressSchema>;
export const entryObject = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  kind: z.enum(["job", "competition", "project"]),
  title: z.string().trim().min(1, "请填写名称").max(500),
  organization: short,
  status: z.string().max(50),
  location: short,
  url,
  deadline: date,
  applied: date,
  followUp: date,
  nextAction: short,
  salary: short,
  priority: short,
  applicationChannel: z.string().trim().max(100).default(""),
  applicationUrl: url,
  applicationReminderDays: z.number().int().min(0).max(90).nullable().default(null),
  applicationRemindersEnabled: z.boolean().nullable().default(null),
  appointments: z
    .array(appointmentSchema)
    .max(200)
    .default([])
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "日程 ID 不能重复",
    )
    .refine(
      (items) =>
        items.filter((item) => item.type !== "followup" && item.stageState === "current").length <=
        1,
      "只能有一个当前招聘阶段",
    ),
  progress: z
    .array(progressSchema)
    .max(1500)
    .default([])
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      "进度记录 ID 不能重复",
    ),
  workMode: option(workModes),
  employmentType: option(employmentTypes),
  schedule: option(schedules),
  companyType: option(companyTypes),
  companyBasis: short,
  companySource: url,
  companyCountry: z.string().trim().max(200).default(""),
  companyDescription: z.string().max(20000).default(""),
  notes: z.string().max(100000).default(""),
  summary: z.string().max(100000).default(""),
  jd: z.string().max(300000).default(""),
  jdStatus: z.enum(["missing", "partial", "complete"]).default("missing"),
  jdSavedAt: short,
  fit: z.number().min(0).max(10).nullable().default(null),
  career: z.number().min(0).max(10).nullable().default(null),
  returnOffer: z.number().min(0).max(10).nullable().default(null),
  academic: z.number().min(0).max(10).nullable().default(null),
  outlook: z.number().min(0).max(10).nullable().default(null),
  extra: z.record(z.unknown()).default({}),
  revision: z.number().int().min(0).default(0),
});
// Positive write policies: adding a persisted field must not silently expose it
// to partial updates or either generation of AI proposals.
export const entryPatchFields = {
  title: true,
  organization: true,
  status: true,
  location: true,
  url: true,
  deadline: true,
  applied: true,
  followUp: true,
  nextAction: true,
  salary: true,
  priority: true,
  applicationChannel: true,
  applicationUrl: true,
  applicationReminderDays: true,
  applicationRemindersEnabled: true,
  appointments: true,
  progress: true,
  workMode: true,
  employmentType: true,
  schedule: true,
  companyType: true,
  companyBasis: true,
  companySource: true,
  companyCountry: true,
  companyDescription: true,
  notes: true,
  summary: true,
  jd: true,
  jdStatus: true,
  fit: true,
  career: true,
  returnOffer: true,
  academic: true,
  outlook: true,
  extra: true,
} as const satisfies Partial<Record<keyof typeof entryObject.shape, true>>;
export const entryAgentFieldSchema = entryObject
  .pick({ ...entryPatchFields, kind: true })
  .partial()
  .strict();
export const legacyAiEntryFields = {
  kind: true,
  title: true,
  organization: true,
  status: true,
  location: true,
  url: true,
  deadline: true,
  applied: true,
  followUp: true,
  nextAction: true,
  salary: true,
  priority: true,
  applicationChannel: true,
  applicationUrl: true,
  applicationReminderDays: true,
  applicationRemindersEnabled: true,
  workMode: true,
  employmentType: true,
  schedule: true,
  companyType: true,
  companyBasis: true,
  companySource: true,
  companyCountry: true,
  companyDescription: true,
  notes: true,
  summary: true,
  jd: true,
  returnOffer: true,
  academic: true,
} as const satisfies Partial<Record<keyof typeof entryObject.shape, true>>;

// Discard retired job fields before validation so old imports remain readable,
// including legacy notes/extra values that no longer match their former types.
export const entrySchema = z.preprocess(
  (input) =>
    input && typeof input === "object" && "kind" in input && input.kind === "job"
      ? { ...input, notes: "", extra: {} }
      : input,
  entryObject
    .refine((v) => statusesFor(v.kind).includes(v.status), "无效状态")
    .refine((v) => v.jdStatus !== "complete" || v.jd.trim().length > 0, "完整存档必须包含正文"),
);
export type Entry = z.infer<typeof entrySchema>;
export type Attachment = {
  id: string;
  entry_id: string;
  name: string;
  type: string;
  size: number;
  created: string;
};
export type Version = { id: string; entry_id: string; data: string; created: string };
export const score = (
  e: Entry,
  weights: {
    fit: number;
    career: number;
    returnOffer: number;
    academic: number;
    outlook: number;
  } = { fit: 25, career: 25, returnOffer: 20, academic: 15, outlook: 15 },
  assessment?: { returnOffer: number | null; academic: number | null },
) => {
  const values = {
    fit: e.fit,
    career: e.career,
    returnOffer: assessment?.returnOffer ?? e.returnOffer,
    academic: assessment?.academic ?? e.academic,
    outlook: e.outlook,
  };
  const available = Object.entries(weights).filter(
    ([key, weight]) => weight > 0 && values[key as keyof typeof values] !== null,
  );
  const weight = available.reduce((sum, [, w]) => sum + w, 0);
  return weight
    ? Math.round(
        (available.reduce((sum, [key, w]) => sum + values[key as keyof typeof values]! * w, 0) /
          weight) *
          10,
      ) / 10
    : null;
};
export const internshipValue = (e: Entry) => {
  const values = [e.career, e.returnOffer, e.academic].filter((v): v is number => v !== null);
  return values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;
};
export const closed = (e: Entry) =>
  ["未通过", "放弃", "已结束", "获奖", "已完成", "已放弃"].includes(e.status);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: RECRUITING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function defaultJobDeadline(
  entry: Pick<Entry, "kind" | "deadline" | "jdSavedAt" | "notes" | "summary" | "nextAction">,
  now = new Date(),
) {
  void now;
  return entry.kind === "job" ? entry.deadline : "";
}
export function dayDiff(value: string) {
  return Math.round(
    (Date.parse(value + "T00:00:00Z") - Date.parse(today() + "T00:00:00Z")) / 86400000,
  );
}
export function blankEntry(kind: Entry["kind"]): Entry {
  return {
    id: crypto.randomUUID(),
    kind,
    title: "",
    organization: "",
    status: kind === "job" ? "待投递" : kind === "project" ? "进行中" : "关注中",
    workMode: "待核实",
    employmentType: "待核实",
    schedule: "待核实",
    companyType: "待核实",
    companyBasis: "",
    companySource: "",
    companyCountry: "",
    companyDescription: "",
    location: "",
    url: "",
    deadline: "",
    applied: "",
    followUp: "",
    nextAction: "",
    salary: "",
    priority: "",
    notes: "",
    summary: "",
    jd: "",
    jdStatus: "missing",
    jdSavedAt: "",
    fit: null,
    career: null,
    returnOffer: null,
    academic: null,
    outlook: null,
    extra: {},
    revision: 0,
    applicationChannel: "",
    applicationUrl: "",
    applicationReminderDays: null,
    applicationRemindersEnabled: null,
    progress: [],
    appointments: [],
  };
}
