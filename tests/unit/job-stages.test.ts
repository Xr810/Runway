import assert from "node:assert/strict";
import test from "node:test";
import { jobStages, stageOf } from "../../components/app/ui";
import { blankEntry, entrySchema, jobStatuses } from "../../lib/model";
import { isApplied, timelineEvents } from "../../lib/journey";
import { guardStatus } from "../../lib/integration-contract";

test("job columns keep rejection and withdrawal distinct without changing stored statuses", () => {
  assert.deepEqual(
    jobStages.map((stage) => stage.key),
    ["todo", "applied", "test", "ai-assessment", "interview", "offer", "rejected", "withdrawn"],
  );
  assert.equal(stageOf("未通过")?.key, "rejected");
  assert.equal(stageOf("放弃")?.key, "withdrawn");
  assert.equal(stageOf("未通过")?.label, "被拒绝");
  assert.equal(stageOf("放弃")?.label, "已放弃");
  assert.equal(stageOf("终面")?.key, "interview");
  assert.equal(stageOf("未知"), undefined);
});

test("AI assessment is a distinct ordered, serializable applied stage", () => {
  assert.deepEqual(jobStatuses.slice(0, 8), [
    "待投递",
    "已投递",
    "笔试",
    "AI测评",
    "一面",
    "二面",
    "终面",
    "Offer",
  ]);
  assert.equal(stageOf("AI测评")?.label, "AI测评");
  assert.equal(stageOf("笔试")?.key, "test");
  const entry = entrySchema.parse({
    ...blankEntry("job"),
    title: "AI assessment",
    status: "AI测评",
    deadline: "2026-10-20",
  });
  assert.equal(entrySchema.parse(JSON.parse(JSON.stringify(entry))).status, "AI测评");
  assert.equal(isApplied(entry), true);
  assert.equal(
    timelineEvents([entry]).some((event) => event.type === "deadline"),
    false,
  );
  guardStatus({ ...entry, status: "笔试" }, "AI测评");
  guardStatus(entry, "一面");
  assert.throws(() => guardStatus(entry, "笔试"), /倒退/);
  assert.throws(() => guardStatus({ ...entry, status: "一面" }, "AI测评"), /倒退/);
});
