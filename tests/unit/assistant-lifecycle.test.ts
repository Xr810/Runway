import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunReply } from "../../lib/agent-runtime-contract";
import { assistantPollingRunIds } from "../../components/app/assistant-lifecycle";
import type { AssistantMessage } from "../../components/app/assistant-types";

function run(runId: string, runStatus: string, outcomes: Record<string, { status: string }> = {}) {
  return { runId, runStatus, outcomes } as unknown as AgentRunReply;
}

test("polls user runs until an assistant response arrives", () => {
  const messages: AssistantMessage[] = [
    { id: "message", role: "user", text: "go", runId: "pending" },
  ];
  assert.deepEqual(assistantPollingRunIds(messages), ["pending"]);
});

test("stops polling completed runs without queued outcomes", () => {
  const messages: AssistantMessage[] = [
    { id: "user", role: "user", text: "go", runId: "done" },
    {
      id: "assistant",
      role: "assistant",
      text: "done",
      runId: "done",
      run: run("done", "completed", { action: { status: "done" } }),
    },
  ];
  assert.deepEqual(assistantPollingRunIds(messages), []);
});

test("continues polling completed runs with queued work", () => {
  const messages: AssistantMessage[] = [
    {
      id: "assistant",
      role: "assistant",
      text: "queued",
      runId: "queued",
      run: run("queued", "completed", { action: { status: "queued" } }),
    },
  ];
  assert.deepEqual(assistantPollingRunIds(messages), ["queued"]);
});
