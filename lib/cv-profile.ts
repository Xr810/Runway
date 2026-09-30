import { z } from "zod";
import { aiJson } from "./ai-client";
import { saveEvaluationProfile, evaluationProfile } from "./enrichment";
import { profileSchema, type EvaluationProfile } from "./enrichment-contract";

const cvProfileSchema = z.object({
  background: z.string().max(20000),
  goals: z.string().max(10000),
  preferences: z.string().max(10000),
  targets: z.array(z.string().trim().min(1).max(60)).max(10),
}).strict();

export function mergeCvProfile(profile: EvaluationProfile, extracted: z.infer<typeof cvProfileSchema>) {
  return profileSchema.parse({
    ...profile,
    background: profile.background.trim() ? profile.background : extracted.background,
    goals: profile.goals.trim() ? profile.goals : extracted.goals,
    preferences: profile.preferences.trim() ? profile.preferences : extracted.preferences,
    targets: profile.targets.length ? profile.targets : extracted.targets,
  });
}

export async function extractCvProfile() {
  const current = await evaluationProfile();
  if (!current.cvText.trim()) throw Error("请先上传一份已读取文字的简历。");
  const extracted = await aiJson("cv-profile-extraction",
    "你是简历信息整理助手。只根据简历原文提取信息，不补充简历中没有的事实。background用中文概括教育、技能、经历和项目；goals、preferences仅填写简历明确表达的目标与条件，没有信息时留空；targets是适合探索的求职领域，最多10项。不要输出姓名、电话、邮箱等联系方式。",
    JSON.stringify({ cvText: current.cvText }), cvProfileSchema, { maxTokens: 2500 });
  const latest = await evaluationProfile();
  if (latest.revision !== current.revision) throw Error("个人背景在简历提炼期间发生了更新，请重试；已有资料未被覆盖。");
  const merged = mergeCvProfile(latest, extracted);
  return saveEvaluationProfile(merged);
}
