import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCvProfile } from "../../lib/cv-profile";
import { profileSchema } from "../../lib/enrichment-contract";

test("CV extraction fills blank profile fields and preserves user-entered values", () => {
  const current = profileSchema.parse({ revision: 3, cvText: "Resume text", background: "手动背景", targets: ["软件工程"] });
  const merged = mergeCvProfile(current, {
    background: "AI 摘要", goals: "AI 目标", preferences: "AI 偏好", targets: ["量化研究"],
  });
  assert.equal(merged.background, "手动背景");
  assert.deepEqual(merged.targets, ["软件工程"]);
  assert.equal(merged.goals, "AI 目标");
  assert.equal(merged.preferences, "AI 偏好");
  assert.equal(merged.cvText, "Resume text");
  assert.equal(merged.revision, 3);
});

test("CV extraction fills all fields when the profile is blank", () => {
  const merged = mergeCvProfile(profileSchema.parse({}), {
    background: "教育和项目摘要", goals: "软件工程实习", preferences: "新加坡", targets: ["机器学习"],
  });
  assert.equal(merged.background, "教育和项目摘要");
  assert.equal(merged.goals, "软件工程实习");
  assert.equal(merged.preferences, "新加坡");
  assert.deepEqual(merged.targets, ["机器学习"]);
});
