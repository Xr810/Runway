import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, draftCommand } from "../../lib/agent-commands";
import { agentPayloadSchemas, parseAgentOperation } from "../../lib/agent-payload";
import { createAgentDraft } from "../../lib/agent-contract";

test("each command has a payload schema and malformed scope cannot expand to all records", () => {
  assert.deepEqual(Object.keys(agentPayloadSchemas).sort(), [...agentCommands].sort());
  for (const watchIds of [[], "all", [42], null])
    assert.throws(() => parseAgentOperation("scan", { action: "run", watchIds }));
  assert.throws(() =>
    parseAgentOperation("assessment", { action: "run", scope: "all", force: "false" }),
  );
  assert.throws(() => parseAgentOperation("entries", { action: "delete", id: "record" }));
  const old = { path: "/api/scan" as const, body: { action: "run", watchIds: ["only-this"] } };
  assert.deepEqual(parseAgentOperation(draftCommand(old), old.body), {
    command: "scan",
    body: { action: "run", watchIds: ["only-this"] },
  });
  assert.deepEqual(parseAgentOperation("companyCompletion", { names: ["Example"] }).body, {
    names: ["Example"],
    refreshLogo: false,
  });
});

// Checked by tsc, never executed: removing payload correlation makes these fail.
function commandTypeChecks() {
  // @ts-expect-error notification commands cannot accept entry deletion payloads
  createAgentDraft("wrong", "notifications", { action: "delete", id: "entry", revision: 1 });
  // @ts-expect-error delete requires a revision
  createAgentDraft("wrong", "entries", { action: "delete", id: "entry" });
  // @ts-expect-error boolean flags are not strings
  createAgentDraft("wrong", "assessment", { action: "run", scope: "all", force: "false" });
}
void commandTypeChecks;
