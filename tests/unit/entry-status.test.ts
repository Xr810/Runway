import assert from "node:assert/strict";
import test from "node:test";
import * as crypto from "node:crypto";
import * as model from "../../lib/model";
import * as appointments from "../../lib/appointments";
import * as integrationContract from "../../lib/integration-contract";
import { prepareAgentActions, type AgentSnapshot } from "../../lib/agent-contract";
import { prepareAiReply } from "../../lib/ai-contract";
import { profileSchema } from "../../lib/enrichment-contract";
import { loadModule } from "../helpers/load-module";

function writers(entry: model.Entry) {
  const writes: model.Entry[] = [];
  const client = {
    async query(sql: string, args: unknown[] = []) {
      if (sql.startsWith("SELECT data, revision") || sql.startsWith("SELECT data,revision"))
        return { rows: [{ data: entry, revision: entry.revision }], rowCount: 1 };
      if (sql.startsWith("UPDATE entries SET data=")) {
        writes.push(JSON.parse(String(args[0])));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id FROM integration_clients"))
        return { rows: [{ id: "client" }], rowCount: 1 };
      if (
        sql.startsWith("SELECT request_hash") ||
        sql.startsWith("SELECT 1 FROM integration_events")
      )
        return { rows: [], rowCount: 0 };
      if (
        ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) ||
        sql.startsWith("INSERT INTO integration_events")
      )
        return { rows: [], rowCount: 0 };
      throw Error(`Unexpected SQL: ${sql}`);
    },
    release() {},
  };
  const postgres = {
    pool: { connect: async () => client },
    tx: async (work: (db: typeof client) => Promise<unknown>) => work(client),
  };
  const entries = loadModule<typeof import("../../lib/entries")>(
    new URL("../../lib/entries.ts", import.meta.url),
    { "./postgres": postgres, "./model": model, "./appointments": appointments },
  );
  const integrations = loadModule<typeof import("../../lib/integrations")>(
    new URL("../../lib/integrations.ts", import.meta.url),
    {
      "node:crypto": crypto,
      "./postgres": postgres,
      "./model": model,
      "./appointments": appointments,
      "./integration-contract": integrationContract,
      "./notifications": { notify: async () => "notification" },
      "./enrichment": { syncEnrichment: async () => {} },
    },
  );
  return { ...entries, ...integrations, writes };
}

const cases: {
  name: string;
  kind: model.Entry["kind"];
  patch: Partial<model.Entry>;
  expected: string;
}[] = [
  { name: "active job stage", kind: "job", patch: { status: "已投递" }, expected: "跟进申请" },
  { name: "AI assessment stage", kind: "job", patch: { status: "AI测评" }, expected: "AI测评" },
  { name: "offer stage", kind: "job", patch: { status: "Offer" }, expected: "接受 Offer" },
  { name: "rejection clears stale action", kind: "job", patch: { status: "未通过" }, expected: "" },
  { name: "withdrawal clears stale action", kind: "job", patch: { status: "放弃" }, expected: "" },
  {
    name: "explicit override",
    kind: "job",
    patch: { status: "未通过", nextAction: "复盘" },
    expected: "复盘",
  },
  {
    name: "explicit empty action",
    kind: "job",
    patch: { status: "笔试", nextAction: "" },
    expected: "",
  },
  { name: "unrelated edit", kind: "job", patch: { title: "Renamed" }, expected: "联系招聘经理" },
  {
    name: "resubmitted status retains existing patch semantics",
    kind: "job",
    patch: { status: "待投递" },
    expected: "准备投递",
  },
  {
    name: "project status",
    kind: "project",
    patch: { status: "已完成" },
    expected: "联系招聘经理",
  },
  {
    name: "competition status",
    kind: "competition",
    patch: { status: "放弃" },
    expected: "联系招聘经理",
  },
];

for (const { name, kind, patch, expected } of cases) {
  test(`status linkage agrees across update entry points: ${name}`, async () => {
    const old = {
      ...model.blankEntry(kind),
      title: "Status fixture",
      revision: 7,
      nextAction: "联系招聘经理",
      jd: "Keep the full description",
      deadline: "2027-02-14",
    };
    const original = structuredClone(old);
    const snapshot: AgentSnapshot = {
      entries: [old],
      deleted: [],
      directory: { revision: 0, companies: [], channels: [] },
      gigs: [],
      watches: [],
      reminders: [],
      profile: profileSchema.parse({}),
      scanSettings: { enabled: false, time: "08:00", maxAddPerWatch: 5 },
      ai: { base: "", model: "", revision: 0 },
    };
    const agent = prepareAgentActions(
      [{ module: "entry", operation: "update", targetId: old.id, fields: patch }],
      snapshot,
    )[0];
    const legacy = prepareAiReply(
      {
        reply: "Review changes",
        drafts: [{ operation: "update", targetId: old.id, fields: patch }],
      },
      [old],
      [],
      "fixture",
    ).drafts[0];
    const db = writers(old);
    const saved = await db.patchEntry(old.id, old.revision, patch);
    const outputs = [
      ["agent", (agent.body as { entry: model.Entry }).entry],
      ["legacy AI", legacy.entry],
      ["patch writer", saved],
    ] as const;
    for (const [source, entry] of outputs) {
      assert.equal(entry.nextAction, expected, source);
      assert.equal(entry.status, patch.status ?? old.status, source);
      assert.equal(entry.jd, original.jd, source);
      assert.equal(entry.deadline, "2027-02-14", source);
    }
    assert.equal(saved.revision, 8);
    assert.equal(db.writes[0].nextAction, expected);
    const derived = expected !== original.nextAction;
    assert.equal(
      agent.changes.some((c) => c.field === "nextAction"),
      derived,
    );
    assert.equal(legacy.changedFields.includes("nextAction"), derived);
    if (kind === "job") {
      const event = integrationContract.integrationEventSchema.parse({
        action: "update_job",
        requestId: "request",
        summary: "Status update",
        source: { kind: "manual", id: "source", occurredAt: "2026-10-01T00:00:00Z" },
        entryId: old.id,
        expectedRevision: old.revision,
        patch,
      });
      await db.applyIntegrationEvent({ id: "client", name: "Fixture" }, event);
      assert.equal(db.writes[1].nextAction, expected, "integration writer");
      assert.equal(db.writes[1].revision, 8);
      assert.equal(db.writes[1].jd, original.jd);
    }
    assert.deepEqual(old, original, "preparing and applying a patch must not mutate its snapshot");
  });
}

test("full saves and restores preserve explicit next actions; patch guards remain authoritative", async () => {
  const old = {
    ...model.blankEntry("job"),
    title: "Snapshot",
    revision: 4,
    nextAction: "自定事项",
  };
  const db = writers(old);
  for (const nextAction of ["自定事项", ""]) {
    const saved = await db.saveEntry({ ...old, status: "笔试", nextAction });
    assert.equal(saved.entry.nextAction, nextAction);
  }
  const restored = await db.saveEntry({ ...old, status: "放弃", nextAction: "" }, "restore");
  assert.equal(restored.skipped, true);
  assert.equal(restored.entry.nextAction, "自定事项");
  await assert.rejects(db.patchEntry(old.id, 3, { status: "放弃" }), { status: 409 });
  await assert.rejects(db.patchEntry(old.id, 4, { status: "invalid" }), { status: 400 });
  await assert.rejects(db.patchEntry(old.id, 4, { status: "笔试", nextAction: null }), {
    status: 400,
  });
  await assert.rejects(db.patchEntry(old.id, 4, { kind: "project" }), { status: 400 });
  assert.equal(db.writes.length, 2, "rejected patches and skipped restores must not write");
});

test("write policies retain distinct patch and AI boundaries without exposing new fields", async () => {
  const old = { ...model.blankEntry("job"), title: "Policy", revision: 2 };
  const db = writers(old);
  for (const field of ["id", "revision", "jdSavedAt", "futureInternalField", "kind"])
    await assert.rejects(db.patchEntry(old.id, old.revision, { [field]: "bad" }), { status: 400 });
  for (const field of ["id", "revision", "jdSavedAt", "futureInternalField"])
    assert.equal(model.entryAgentFieldSchema.safeParse({ [field]: "bad" }).success, false);
  assert.deepEqual(
    model.entryAgentFieldSchema.parse({ kind: "project", fit: 7, extra: { detail: "kept" } }),
    { kind: "project", fit: 7, extra: { detail: "kept" } },
  );
  for (const field of [
    "fit",
    "career",
    "outlook",
    "extra",
    "appointments",
    "progress",
    "jdStatus",
    "futureInternalField",
  ])
    assert.equal(Object.hasOwn(model.legacyAiEntryFields, field), false);
  assert.equal(Object.hasOwn(model.legacyAiEntryFields, "returnOffer"), true);
  assert.equal(Object.hasOwn(model.legacyAiEntryFields, "academic"), true);
  assert.equal(db.writes.length, 0);
});

test("job writers discard retired fields while other record kinds retain them", async () => {
  for (const kind of ["job", "project", "competition"] as const) {
    const old = { ...model.blankEntry(kind), title: "Retired fields", revision: 2 };
    const fields = { notes: "Fixture note", extra: { source: "Fixture import" } };
    const db = writers(old);
    const full = (await db.saveEntry({ ...old, ...fields })).entry;
    const patched = await db.patchEntry(old.id, old.revision, fields);
    for (const entry of [full, patched, ...db.writes]) {
      assert.equal(entry.notes, kind === "job" ? "" : fields.notes);
      assert.deepEqual(entry.extra, kind === "job" ? {} : fields.extra);
    }
    assert.equal(old.notes, "", "normalization must not mutate input");
  }
  const job = { ...model.blankEntry("job"), title: "Legacy backup", notes: null, extra: [] };
  assert.equal(model.entrySchema.parse(job).notes, "");
  assert.deepEqual(model.entrySchema.parse(job).extra, {});
});
