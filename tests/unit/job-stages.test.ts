import assert from "node:assert/strict";
import test from "node:test";
import { jobStages, stageOf } from "../../components/app/ui";

test("job columns keep rejection and withdrawal distinct without changing stored statuses", () => {
  assert.deepEqual(
    jobStages.map((stage) => stage.key),
    ["todo", "applied", "test", "interview", "offer", "rejected", "withdrawn"],
  );
  assert.equal(stageOf("未通过")?.key, "rejected");
  assert.equal(stageOf("放弃")?.key, "withdrawn");
  assert.equal(stageOf("未通过")?.label, "被拒绝");
  assert.equal(stageOf("放弃")?.label, "已放弃");
  assert.equal(stageOf("终面")?.key, "interview");
  assert.equal(stageOf("未知"), undefined);
});
