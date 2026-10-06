import { z } from "zod";
import {
  entrySchema,
  jobStatuses,
  workModes,
  employmentTypes,
  schedules,
  companyTypes,
  type Entry,
} from "./model";
import { appointmentSchema } from "./appointments";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const web = z
  .string()
  .max(4000)
  .refine(
    (v) =>
      !v ||
      (URL.canParse(v) && /^https?:\/\//i.test(v) && !new URL(v).username && !new URL(v).password),
  )
  .default("");
export const sourceSchema = z
  .object({
    kind: z.enum(["website", "email", "manual"]),
    id: z.string().trim().min(1).max(500),
    url: web,
    subject: z.string().max(500).default(""),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
const choice = (values: string[]) =>
  z.string().refine((value) => values.includes(value), "无效的岗位属性");
const fields = {
  title: z.string().trim().min(1).max(500),
  organization: z.string().trim().min(1).max(2000),
  url: web,
  location: z.string().max(2000),
  status: z.enum(jobStatuses as [string, ...string[]]),
  deadline: z.string(),
  applied: z.string(),
  followUp: z.string(),
  nextAction: z.string().max(2000),
  salary: z.string().max(2000),
  summary: z.string().max(100000),
  jd: z.string().max(300000),
  applicationChannel: z.string().max(100),
  applicationUrl: web,
  workMode: choice(workModes),
  employmentType: choice(employmentTypes),
  schedule: choice(schedules),
  companyType: choice(companyTypes),
  companyBasis: z.string().max(2000),
  companySource: web,
  priority: z.enum(["", "高", "中", "低"]),
};
const base = {
  requestId: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2000),
  source: sourceSchema,
};
export const integrationEventSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("create_job"),
      externalId: z.string().trim().min(1).max(500),
      job: z
        .object(fields)
        .partial()
        .required({ title: true, organization: true, url: true })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("update_job"),
      entryId: id,
      expectedRevision: z.number().int().min(1),
      patch: z.object(fields).partial().strict().default({}),
      appointment: appointmentSchema.optional(),
      note: z.string().max(4000).optional(),
    })
    .strict(),
  z.object({ ...base, action: z.literal("notify"), entryId: id.optional() }).strict(),
]);
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;
export class IntegrationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function validateJob(value: unknown) {
  const result = entrySchema.safeParse(value);
  if (!result.success)
    throw new IntegrationError(400, "invalid_entry", result.error.issues[0].message);
  return result.data;
}
export function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith("utm_") || ["gclid", "fbclid"].includes(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return value;
  }
}
export function guardStatus(old: Entry, status: string | undefined) {
  if (!status || old.status === status) return;
  const stages = ["待投递", "已投递", "笔试", "AI测评", "一面", "二面", "终面", "Offer"];
  if (
    ["未通过", "放弃", "Offer"].includes(old.status) ||
    (stages.indexOf(status) >= 0 && stages.indexOf(status) < stages.indexOf(old.status))
  )
    throw new IntegrationError(
      409,
      "status_review_required",
      "旧邮件可能导致状态倒退，请使用 notify 留待人工核对。",
    );
}
export function changedFields(before: Entry | null, after: Entry) {
  return Object.keys(after)
    .filter((key) => {
      if (["id", "kind", "revision", "extra", "jdSavedAt"].includes(key)) return false;
      const value = after[key as keyof Entry];
      if (
        before === null &&
        (value === null ||
          value === "" ||
          value === "待核实" ||
          value === "missing" ||
          (Array.isArray(value) && !value.length))
      )
        return false;
      return JSON.stringify(before?.[key as keyof Entry]) !== JSON.stringify(value);
    })
    .map((field) => ({
      field,
      before: before?.[field as keyof Entry] ?? null,
      after: after[field as keyof Entry],
    }));
}
