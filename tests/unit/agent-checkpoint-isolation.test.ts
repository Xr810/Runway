import { test } from "node:test";
import assert from "node:assert/strict";
import { agentCheckpointConfig } from "../../lib/agent-checkpoint";

test("agent checkpoints are isolated by the run owner", () => {
  const runId = "33333333-3333-4333-8333-333333333333";
  const accountA = "11111111-1111-4111-8111-111111111111";
  const accountB = "22222222-2222-4222-8222-222222222222";
  assert.notEqual(agentCheckpointConfig(runId, accountA).configurable.thread_id, agentCheckpointConfig(runId, accountB).configurable.thread_id);
  assert.equal(agentCheckpointConfig(runId, accountA).configurable.thread_id, `${accountA}:${runId}`);
});
