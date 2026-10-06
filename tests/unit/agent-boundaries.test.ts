import assert from "node:assert/strict";
import test from "node:test";
import { agentCommands, draftCommand, type AgentDestination } from "../../lib/agent-commands";
import { agentPolicy, assertAgentCommand } from "../../lib/agent-policy";
import {
  agentCapabilities,
  capabilitiesForPolicy,
  commandForModule,
} from "../../lib/agent-capabilities";
import { aiReplySchema } from "../../lib/ai-contract";
import { agentReadSchema, type AgentSnapshot } from "../../lib/agent-contract";
import { loadModule } from "../helpers/load-module";
import { runModelGraph } from "../../lib/agent-model-loop";
import { z } from "zod";
import { isAgentJob, agentJobCommands } from "../../lib/agent-commands";
import { parseAgentOperation } from "../../lib/agent-payload";
import { blankEntry } from "../../lib/model";
import { appointmentSchema } from "../../lib/appointments";
import { defaultReminderPreferences, effectiveFollowUp } from "../../lib/recruiting-reminders";
import { timelineEvents } from "../../lib/journey";

test("legacy destinations distinguish jobs from settings; ambiguous commands fail closed", () => {
  assert.equal(draftCommand({ path: "/api/scan", body: { action: "run" } }), "scan");
  assert.equal(draftCommand({ path: "/api/scan", body: { action: "settings" } }), "scanSettings");
  assert.equal(draftCommand({ path: "/api/enrichment", body: { action: "profile" } }), "profile");
  assert.equal(draftCommand({ path: "/api/enrichment", body: { action: "lock" } }), "evaluation");
  assert.equal(draftCommand({ path: "/api/enrichment", body: { action: "run" } }), "assessment");
  assert.equal(draftCommand({ command: "entries", body: {} }), "entries");
  assert.throws(() => draftCommand({ path: "/api/scan", body: {} }), /旧版/);
  const ambiguous = {
    command: "entries",
    path: "/api/brief",
    body: {},
  } as unknown as AgentDestination & { body: unknown };
  assert.throws(() => draftCommand(ambiguous), /无效/);
  assert.throws(
    () =>
      draftCommand({ command: "gmail.send", body: {} } as unknown as AgentDestination & {
        body: unknown;
      }),
    /无效/,
  );
});

test("capabilities and grants cover every business command without permitting unknown tools", () => {
  assert.deepEqual(new Set(Object.values(commandForModule)), new Set(agentCommands));
  assert.deepEqual(
    new Set(agentCapabilities.map((c) => c.module)),
    new Set(Object.keys(commandForModule)),
  );
  const managed = agentPolicy({ enabled: true, mode: "managed" });
  assertAgentCommand(managed, "entries");
  assert.throws(() => assertAgentCommand(managed, "model"), /权限/);
  assert.equal(
    capabilitiesForPolicy(managed).some((c) => c.module === "model"),
    false,
  );
  const disabled = agentPolicy({ enabled: false, mode: "personal" });
  assert.deepEqual(capabilitiesForPolicy(disabled), []);
  assert.throws(() => assertAgentCommand(disabled, "entries"), /权限/);
  const limited = { enabled: true, commands: ["entries"] as const };
  assert.deepEqual(
    capabilitiesForPolicy(limited)
      .map((c) => c.module)
      .sort(),
    ["appointment", "entry", "progress", "version"],
  );
  assert.throws(() => assertAgentCommand(limited, "notifications"), /权限/);
});

test("planning does not fetch all history and restore hydration reads only requested IDs", async () => {
  const ids: string[] = [];
  const context = loadModule<typeof import("../../lib/agent-context")>(
    new URL("../../lib/agent-context.ts", import.meta.url),
    {
      "./agent-capabilities": { agentCapabilities: [] },
      "./scanner": { scanSettings: async () => ({ enabled: true }) },
      "./company-complete": {},
      "./agent-contract": { agentReadSchema },
      "./entries": {
        listDeleted: async () => [],
        listVersions: () => {
          throw Error("Must not eagerly load history");
        },
        getVersion: async (id: string) => {
          ids.push(id);
          return id === "missing" ? null : { id, entry_id: "entry-1", data: "historical body" };
        },
      },
      "./directory-storage": {
        getDirectory: async () => ({ revision: 0, companies: [], channels: [] }),
      },
      "./notifications": {},
      "./enrichment": {},
      "./brief": {},
      "./postgres": {},
      "./model": {},
      "./reminder-preferences": {
        getReminderPreferences: async () => ({
          ...defaultReminderPreferences,
          assessment: { ...defaultReminderPreferences.assessment, planDays: 5 },
        }),
      },
      "./journey": { timelineEvents },
      "./recruiting-reminders": { effectiveFollowUp },
      "./ai-contract": { aiReplySchema },
    },
  );
  const snapshot = await context.loadAgentSnapshot({ entries: [] } as unknown as AgentSnapshot);
  assert.equal(snapshot.versions, undefined);
  await context.loadProposalVersions({ reply: "nothing to restore", actions: [] }, snapshot);
  assert.deepEqual(ids, []);
  const restore = (itemId: string) => ({
    module: "version",
    operation: "restore",
    targetId: "entry-1",
    itemId,
  });
  await context.loadProposalVersions(
    { reply: "restore", actions: [restore("v2"), restore("v2"), restore("missing")] },
    snapshot,
  );
  assert.deepEqual(ids, ["v2", "missing"]);
  assert.deepEqual(snapshot.versions, [{ id: "v2", entry_id: "entry-1", data: "historical body" }]);
  await assert.rejects(
    context.loadProposalVersions(
      { reply: "too many", actions: Array.from({ length: 13 }, () => restore("v3")) },
      snapshot,
    ),
  );
  assert.deepEqual(ids, ["v2", "missing"], "validate the read budget before database access");
  snapshot.entries = [
    {
      ...blankEntry("job"),
      id: "assessment-job",
      title: "Derived dates",
      appointments: [
        appointmentSchema.parse({
          id: "assessment",
          title: "Test",
          type: "assessment",
          startsAt: "",
          receivedDate: "2026-09-29",
        }),
      ],
    },
  ];
  const read = (await context.readAgentData(
    { module: "entries", id: "assessment-job", offset: 0 },
    snapshot,
  )) as { derivedSchedule: { date: string; label: string }[] };
  assert.equal(read.derivedSchedule[0].date, "2026-10-04");
  assert.equal(read.derivedSchedule[0].label, "测评计划期限");
  assert.equal(snapshot.entries[0].appointments[0].deadlineDate, "");
  assert.equal("derivedSchedule" in snapshot.entries[0], false);
  snapshot.entries[0].appointments[0] = {
    ...snapshot.entries[0].appointments[0],
    status: "completed",
    completedAt: "2026-09-30T00:00:00+08:00",
  };
  const completed = (await context.readAgentData(
    { module: "entries", id: "assessment-job", offset: 0 },
    snapshot,
  )) as { effectiveFollowUp: { date: string; source: string } };
  assert.equal(completed.effectiveFollowUp.date, "2026-10-07");
  assert.equal(completed.effectiveFollowUp.source, "automatic");
  assert.equal(snapshot.entries[0].followUp, "");
});

test("async proposal preparation is awaited and failures enter the bounded repair loop", async () => {
  let calls = 0;
  const result = await runModelGraph([], {
    call: async () => {
      calls++;
      return '{"reply":"ok"}';
    },
    read: async () => [],
    prepare: async () => {
      await Promise.resolve();
      if (calls === 1) throw Error("missing version");
      return { hydrated: true };
    },
  });
  assert.deepEqual(result, { hydrated: true });
  assert.equal(calls, 2);
});

test("execution rechecks live grants and legacy replay reuses the same receipt", async () => {
  let enabled = true,
    mutations = 0,
    transactions = 0;
  const receipts = new Map<string, { run_id: string; result: unknown }>();
  const client = {
    query: async (sql: string, args: unknown[]) => {
      if (sql.startsWith("SELECT run_id"))
        return { rows: receipts.has(String(args[0])) ? [receipts.get(String(args[0]))] : [] };
      if (sql.startsWith("INSERT INTO agent_operations"))
        receipts.set(String(args[0]), {
          run_id: String(args[1]),
          result: JSON.parse(String(args[3])),
        });
      return { rows: [] };
    },
  };
  const { executeAgentDraft } = loadModule<typeof import("../../lib/agent-executor")>(
    new URL("../../lib/agent-executor.ts", import.meta.url),
    {
      "node:crypto": {},
      zod: { z },
      "./postgres": {
        atomicAgentWrite: async (work: (db: typeof client) => Promise<unknown>) => {
          transactions++;
          return work(client);
        },
      },
      "./entries": {},
      "./part-time": {},
      "./watch-storage": {},
      "./reminders": {},
      "./directory-storage": {},
      "./journey": {},
      "./watches": {},
      "./model": {},
      "./part-time-contract": {},
      "./enrichment": {},
      "./enrichment-contract": {},
      "./scanner": {},
      "./ai-config": { getAiConfig: async () => ({ enabled, mode: "personal" }) },
      "./notifications": {
        markNotifications: async () => {
          mutations++;
        },
        notify: async () => {},
      },
      "./files": {},
      "./ai-contract": {},
      "./attachments": {},
      "./agent-attachments": {},
      "./agent-commands": { draftCommand, isAgentJob },
      "./agent-payload": { parseAgentOperation },
      "./agent-policy": { agentPolicy, assertAgentCommand },
    },
  );
  const draft = {
    id: crypto.randomUUID(),
    title: "mark read",
    command: "notifications" as const,
    body: { action: "read", ids: [crypto.randomUUID()] },
    changes: [],
  };
  const decision = { proposalId: draft.id, approved: true, allowDuplicate: false };
  const first = await executeAgentDraft("run", draft, decision);
  const { command: _, ...oldDraft } = draft;
  void _;
  const replay = await executeAgentDraft(
    "run",
    { ...oldDraft, path: "/api/notifications" },
    decision,
  );
  assert.deepEqual(first, replay);
  assert.equal(mutations, 1);
  assert.deepEqual(await executeAgentDraft("run", { ...draft, body: null }, decision), first);
  await assert.rejects(
    executeAgentDraft(
      "run",
      { ...draft, id: crypto.randomUUID(), body: { action: "read", ids: "wrong" } },
      decision,
    ),
  );
  assert.equal(mutations, 1, "invalid payloads must fail before business writes");
  const beforeRevocation = transactions;
  enabled = false;
  await assert.rejects(
    executeAgentDraft("run", { ...draft, id: crypto.randomUUID() }, decision),
    /权限/,
  );
  assert.equal(
    transactions,
    beforeRevocation,
    "revoked permission must fail before opening a write transaction",
  );
  assert.equal(mutations, 1);
});

test("queued work checks permissions at dispatch rather than trusting prior approval", async () => {
  let enabled = false,
    calls = 0;
  const states: string[] = [];
  const client = {
    query: async (sql: string) => ({
      rows: sql.includes("FROM accounts") ? [{ id: "owner" }] : [{ ok: true }],
    }),
    release() {},
  };
  const { runAgentJobs } = loadModule<typeof import("../../lib/agent-jobs")>(
    new URL("../../lib/agent-jobs.ts", import.meta.url),
    {
      zod: { z },
      "./enrichment": {},
      "./scanner": {},
      "./company-complete": {},
      "./builtin-enrichment": {},
      "./enrichment-contract": {},
      "./brief": {
        generateBrief: async () => {
          calls++;
          return { title: "fixture" };
        },
      },
      "./agent-commands": { agentJobCommands },
      "./agent-payload": { parseAgentOperation },
      "./agent-policy": { agentPolicy, assertAgentCommand },
      "./ai-config": { getAiConfig: async () => ({ enabled, mode: "personal" }) },
      "./postgres": {
        controlPool: { connect: async () => client },
        runAsUser: async (_owner: string, work: () => Promise<void>) => work(),
        pool: {
          query: async (sql: string) => {
            if (sql.startsWith("SELECT id,kind"))
              return { rows: [{ id: "job", kind: "brief", payload: {} }] };
            if (sql.includes("status='failed'")) states.push("failed");
            if (sql.includes("status='completed'")) states.push("completed");
            return { rows: [] };
          },
        },
      },
    },
    { globalThis: {} },
  );
  await runAgentJobs();
  assert.equal(calls, 0);
  assert.deepEqual(states, ["failed"]);
  enabled = true;
  await runAgentJobs();
  assert.equal(calls, 1);
  assert.deepEqual(states, ["failed", "completed"]);
});
