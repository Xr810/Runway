import { z } from "zod";

export const jdSummarySections = {
  responsibilities: "岗位职责与团队方向",
  required: "必备条件",
  preferred: "加分项",
  education: "学历与毕业时间",
  internship: "实习时间与长度",
  locations: "工作地点",
  deadlines: "申请期限",
  process: "JD 招聘流程（非实际进度）",
} as const;
const points = z
  .array(
    z
      .object({
        text: z.string().trim().min(1).max(2000),
        quote: z.string().trim().min(1).max(3000),
      })
      .strict(),
  )
  .max(25);
export const jdSummarySchema = z
  .object({
    responsibilities: points,
    required: points,
    preferred: points,
    education: points,
    internship: points,
    locations: points,
    deadlines: points,
    process: points,
    questions: z.array(z.string().trim().min(1).max(1000)).max(15),
  })
  .strict();
export type JdSummary = z.infer<typeof jdSummarySchema>;

/** Every assertion must carry a literal source excerpt; this does not prove the translation. */
export function groundJdSummary(value: unknown, jd: string): JdSummary {
  const result = jdSummarySchema.parse(value);
  for (const key of Object.keys(jdSummarySections) as (keyof typeof jdSummarySections)[]) {
    if (result[key].some((point) => !jd.includes(point.quote)))
      throw Error("摘要引用无法在 JD 原文中核对");
    result[key] = result[key].filter(
      (point, index, items) =>
        items.findIndex((other) => other.text === point.text && other.quote === point.quote) ===
        index,
    );
  }
  return result;
}

export type JdSummaryView = {
  status: "missing" | "pending" | "unconfigured" | "completed" | "failed";
  summary?: JdSummary;
  error?: string;
};
