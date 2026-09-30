import { z } from "zod";
import { assessmentSchema } from "./enrichment-contract";
import type { TaskInput } from "./enrichment";

function normalizeEvidence(value: unknown): unknown {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  const useful = ["text", "content", "quote", "reason", "source", "title", "value"]
    .map(key => item[key]).filter((part): part is string => typeof part === "string" && !!part.trim());
  return useful.length ? useful.join(" · ") : JSON.stringify(value);
}
const factorWithFlexibleEvidence = z.object({
  score: z.number().min(0).max(10).nullable(), reason: z.string().trim().min(1).max(4000),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.preprocess(normalizeEvidence, z.string().trim().min(1).max(4000))).max(20),
}).strict();

/** Provider metadata is ignored; only the server can supply provenance. */
export const builtinAssessmentSchema = assessmentSchema.omit({ model: true, sources: true }).extend({
  fit: factorWithFlexibleEvidence, career: factorWithFlexibleEvidence, returnOffer: factorWithFlexibleEvidence.optional(), academic: factorWithFlexibleEvidence.optional(), outlook: factorWithFlexibleEvidence,
  model: z.unknown().optional(),
  sources: z.unknown().optional(),
});

/** Ground provider output in the actual inputs and fetched sources, never invented citations. */
export function groundAssessment(raw: z.infer<typeof builtinAssessmentSchema>, input: TaskInput, model: string, sources: { title: string; url: string; checkedAt: string }[]) {
  const result = assessmentSchema.parse({ ...raw, model, sources });
  result.returnOffer = raw.returnOffer || { score: null, reason: "暂无可核实的 return offer 机制或往届转正资料。", confidence: "low", evidence: [] };
  result.academic = raw.academic || { score: null, reason: "暂无可核实的研究内容、导师或升学相关资料。", confidence: "low", evidence: [] };
  const unknown = (key: "fit" | "career" | "returnOffer" | "academic" | "outlook", reason: string) => { result[key] = { score: null, reason, confidence: "low", evidence: [] }; };
  if (!input.profile?.background.trim() && !input.profile?.cvText.trim()) unknown("fit", "缺少个人背景或简历，不能判断匹配度。");
  if (!input.job?.jd.trim() && !input.job?.summary.trim()) { unknown("fit", "缺少 JD 或岗位摘要。"); unknown("career", "缺少 JD 或岗位摘要。"); }
  if (!input.profile?.goals.trim() && !input.profile?.targets.length) unknown("career", "缺少职业目标或求职方向。");
  if (!sources.length) unknown("outlook", "没有可核验的公司资料来源，不推测公司前景。");
  if (!sources.length && result.returnOffer.score !== null) unknown("returnOffer", "没有可核验的转正机制、比例或往届实习生去向来源。");
  for (const k of ["fit", "career", "returnOffer", "academic", "outlook"] as const) if (result[k].score !== null && !result[k].evidence.length) unknown(k, "缺少评分依据。");
  return result;
}
