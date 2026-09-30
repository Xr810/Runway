import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareAgentActions, type AgentSnapshot, agentActionSchema } from "../../lib/agent-contract";
import { blankEntry, entryObject, today } from "../../lib/model";
import { profileSchema, type Assessment, rubric } from "../../lib/enrichment-contract";
import { newGig } from "../../lib/part-time-contract";
import { blankWatch } from "../../lib/watches";
import { groundAssessment } from "../../lib/builtin-assessment";
const job = { ...blankEntry("job"), title: "Test job", revision: 5, jd: "Original JD", extra: { keep: "yes" } };
const project = { ...blankEntry("project"), title: "Test project", revision: 2, progress: [{ id: "p1", date: today(), text: "First", minutes: 20, track: "", milestone: false }] };
const gig = { ...newGig(), title: "Gig", revision: 3, payments: [{ id: "income1", amountMinor: 12000, currency: "HKD" as const, status: "pending" as const, date: today(), period: "", note: "", voided: false }] };
const snapshot: AgentSnapshot = { entries: [job, project], deleted: [{ ...job, id: "deleted" }], directory: { revision: 9, companies: [{ name: "Example", website: "https://example.com", logoUrl: "" }], channels: [] }, gigs: [gig], watches: [{ ...blankWatch(), id: "watch", company: "Example", url: "https://example.com/jobs", revision: 2 }], reminders: [], profile: profileSchema.parse({}), scanSettings: { enabled: true, time: "08:00", maxAddPerWatch: 5 }, ai: { base: "https://api.example.com/v1", model: "m", revision: 4 } };
function one(value: unknown) { return prepareAgentActions([value], snapshot)[0]; }
function body(d: ReturnType<typeof one>) { return d.body as Record<string, any>; } // eslint-disable-line @typescript-eslint/no-explicit-any

test("all editable entry fields are accepted, system fields and unknown fields rejected", () => {
  for (const key of Object.keys(entryObject.shape).filter(k => !["id", "revision", "jdSavedAt"].includes(k))) {
    const value = job[key as keyof typeof job];
    const out = body(one({ module: "entry", operation: "update", targetId: job.id, fields: { [key]: value } }));
    assert.equal(out.entry.revision, 5); assert.equal(out.entry.jd, "Original JD");
  }
  for (const field of ["id", "revision", "jdSavedAt", "unknown"]) assert.throws(() => one({ module: "entry", operation: "update", targetId: job.id, fields: { [field]: "override" } }));
  assert.throws(() => one({ module: "entry", operation: "update", targetId: job.id, fields: { fit: 20 } }));
  assert.throws(() => one({ module: "entry", operation: "delete", targetId: "missing" }));
  assert.equal(body(one({ module: "entry", operation: "restore", targetId: "deleted" })).action, "undelete");
});
test("nested edits preserve other data and use the parent revision", () => {
  const added = body(one({ module: "appointment", operation: "add", targetId: job.id, fields: { title: "Interview", type: "interview", startsAt: "2026-10-01T14:00:00+08:00" } })).entry;
  assert.equal(added.appointments.length, 1); assert(added.appointments[0].id); assert.equal(added.jd, job.jd); assert.equal(added.revision, 5);
  const updated = body(one({ module: "progress", operation: "update", targetId: project.id, itemId: "p1", fields: { text: "Corrected" } })).entry;
  assert.equal(updated.progress[0].minutes, 20); assert.equal(updated.progress[0].id, "p1"); assert.equal(updated.progress[0].text, "Corrected");
  assert.throws(() => one({ module: "progress", operation: "delete", targetId: project.id, itemId: "missing" }));
  assert.throws(() => one({ module: "appointment", operation: "add", targetId: job.id, fields: { id: "forced" } }));
});
test("directory, archived gigs, voided income and watch notes use complete preserved snapshots", () => {
  const d = body(one({ module: "company", operation: "update", targetId: "Example", fields: { logoUrl: "https://example.com/logo.png" } })).directory;
  assert.equal(d.revision, 9); assert.equal(d.companies[0].website, "https://example.com");
  assert.equal(body(one({ module: "gig", operation: "update", targetId: gig.id, fields: { archived: true } })).payments.length, 1);
  assert.equal(body(one({ module: "payment", operation: "void", targetId: gig.id, itemId: "income1" })).payments[0].voided, true);
  assert.equal(body(one({ module: "watch", operation: "update", targetId: "watch", fields: { notes: "changed" } })).watch.url, "https://example.com/jobs");
  assert.throws(() => one({ module: "company", operation: "update", targetId: "Example", fields: { website: "javascript:bad" } }));
});
test("credentials, arbitrary endpoints and duplicate conflicting writes cannot be proposed", () => {
  assert(!agentActionSchema.safeParse({ module: "model", operation: "update", fields: { model: "new", apiKey: "secret" } }).success);
  assert(!agentActionSchema.safeParse({ module: "brief", operation: "refresh", endpoint: "https://attacker.example" }).success);
  assert.equal(body(one({ module: "model", operation: "update", fields: { model: "new" } })).base, snapshot.ai.base);
  const change = { module: "entry", operation: "update", targetId: job.id, fields: { title: "new" } };
  assert.throws(() => prepareAgentActions([change, change], snapshot), /同一记录/);
  assert.throws(() => one({ module: "scanSettings", operation: "update", fields: { time: "99:00" } }));
});
test("assessments cannot invent sources or score missing inputs", () => {
  const factor = { score: 9, reason: "good", confidence: "high" as const, evidence: ["some data"] };
const raw: Assessment = { kind: "assessment", model: "invented", summary: "test", fit: factor, career: factor, returnOffer:{score:null,reason:"unknown",confidence:"low",evidence:[]}, academic:{score:null,reason:"unknown",confidence:"low",evidence:[]}, outlook: factor, hardConstraints: [], missing: [], sources: [{ title: "Fake", url: "https://fake.example", checkedAt: new Date().toISOString() }] };
  const result = groundAssessment(raw, { target: { kind: "job", id: job.id }, name: "test", rubric }, "actual-model", []);
  assert.equal(result.fit.score, null); assert.equal(result.career.score, null); assert.equal(result.outlook.score, null); assert.deepEqual(result.sources, []); assert.equal(result.model, "actual-model");
});


test("concatenated provider replies only consume a first read, never a premature write", async () => {
  const { parseAgentResponse } = await import("../../lib/agent-protocol");
  assert.deepEqual(parseAgentResponse('{"reads":[{"module":"directory"}]}\n{"reply":"saved","actions":[]}'), { reads: [{ module: "directory" }] });
  assert.deepEqual(parseAgentResponse('  ```json\n{"reply":"ok"}\n```  '), { reply: "ok" });
  assert.throws(() => parseAgentResponse('{"reply":"first"}{"reply":"second"}'));
  assert.throws(() => parseAgentResponse('{"reads":[]} {"reply":"bad"}'));
});
