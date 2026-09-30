// Requires a running app against the SAME disposable database named *_test.
// DATABASE_URL=... BASE_URL=... TEST_PASSWORD=... node --import tsx --test tests/integration/audit-regressions.test.ts
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../lib/postgres";
import { blankEntry } from "../../lib/model";
import { weightKeys } from "../../lib/enrichment-contract";
import { saveEntry, patchEntry, getEntry, listVersions, deleteEntry } from "../../lib/entries";
import { claimEnrichment, completeEnrichment, syncEnrichment, localActor } from "../../lib/enrichment";
import { exportArchive, readArchive, restoreArchive } from "../../lib/backup-archive";
import { localFiles } from "../../lib/files";
import { strToU8, zipSync } from "fflate";

const base = process.env.BASE_URL || "http://localhost:3000";
let cookie = "";
const request: typeof fetch = (path, init = {}) => fetch(new URL(String(path), base), { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), origin: new URL(base).origin, cookie } });
const post = async (path: string, body: unknown) => {
  const r = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data;
};
const create = (patch = {}) => saveEntry({ ...blankEntry("job"), title: "[test] audit regression", ...patch });

before(async () => {
  assert.match((await pool.query("SELECT current_database() AS name")).rows[0].name, /_test$/, "Never run this suite on a real database");
  const r = await fetch(base + "/api/auth", { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: JSON.stringify({ password: process.env.TEST_PASSWORD }) });
  assert.equal(r.status, 200); cookie = r.headers.get("set-cookie")!.split(";")[0];
  const sentinel = (await create({ title: "[test] verify shared database" })).entry;
  try { assert.equal((await request("/api/desk?entry=" + sentinel.id)).status, 200, "App and test must use the same database"); }
  finally { await pool.query("DELETE FROM entries WHERE id=$1", [sentinel.id]); }
});
after(() => pool.end());

test("status patches clear stale next actions for terminal stages", async () => {
  let entry = (await create({ nextAction: "跟进申请" })).entry;
  entry = await patchEntry(entry.id, entry.revision, { status: "未通过" });
  assert.equal(entry.nextAction, "");
  entry = await patchEntry(entry.id, entry.revision, { status: "已投递" });
  assert.equal(entry.nextAction, "跟进申请");
  entry = await patchEntry(entry.id, entry.revision, { status: "放弃", nextAction: "记录拒绝原因" });
  assert.equal(entry.nextAction, "记录拒绝原因");
});

for (const key of weightKeys) test(`manual ${key}: insert, edit, clear, and in-flight completion remain protected`, async () => {
  const inserted = (await create({ [key]: 9 })).entry;
  const locked = async (id: string) => (await pool.query("SELECT locked FROM enrichment_state WHERE kind='job' AND target_id=$1", [id])).rows[0]?.locked;
  assert.equal(await locked(inserted.id), true);
  const fresh = (await create()).entry;
  await syncEnrichment();
  const taskId = (await pool.query("SELECT id FROM enrichment_tasks WHERE target_id=$1 AND status='pending'", [fresh.id])).rows[0].id;
  const task = (await claimEnrichment(localActor, ["job"], 1, taskId)).tasks[0];
  const edited = await patchEntry(fresh.id, fresh.revision, { [key]: 8 });
  assert.equal(await locked(fresh.id), true);
  const unknown = { score: null, reason: "Test fixture: insufficient evidence", confidence: "low", evidence: [] };
  await assert.rejects(completeEnrichment(localActor, task.id, task.leaseToken, {
    kind: "assessment", model: "fixture", summary: "Test assessment", fit: unknown, career: unknown, returnOffer: unknown, academic: unknown, outlook: unknown, hardConstraints: [], missing: [], sources: [],
  }), /手动锁定/);
  assert.equal((await getEntry(fresh.id))![key], 8);
  await pool.query("UPDATE enrichment_state SET locked=false WHERE target_id=$1", [fresh.id]);
  await patchEntry(fresh.id, edited.revision, { [key]: null });
  assert.equal(await locked(fresh.id), true, "clearing a score is a manual edit too");
});

test("summary and source URL archive the prior content without changing the JD timestamp", async () => {
  let e = (await create({ jd: "JD unchanged", summary: "original summary", url: "https://example.com/original" })).entry;
  const stamp = e.jdSavedAt;
  e = await patchEntry(e.id, e.revision, { summary: "new summary" });
  e = await patchEntry(e.id, e.revision, { url: "https://example.com/new" });
  await patchEntry(e.id, e.revision, { priority: "高" });
  const versions = await listVersions(e.id, true);
  assert.equal(versions.length, 2);
  const snapshots = versions.map(v => JSON.parse("data" in v ? String(v.data) : "{}"));
  assert(snapshots.some(v => v.summary === "original summary"));
  assert(snapshots.every(v => v.url === "https://example.com/original"));
  assert.equal(e.jdSavedAt, stamp);
});

test("long Chinese CV permits editing the profile and score weights", async () => {
  const cv = "实习研究项目。".repeat(8500); // 59,500 characters / 178,500 bytes
  const form = new FormData(); form.append("file", new File([cv], "large-cv.txt"));
  assert.equal((await request("/api/profile/cv", { method: "POST", body: form })).status, 200);
  const { profile } = await (await request("/api/enrichment")).json();
  const saved = await post("/api/enrichment", { action: "profile", profile: { ...profile, goals: "Research", evaluationPreset: "custom", evaluationWeights: { fit: 100, career: 0, returnOffer: 0, academic: 0, outlook: 0 } } });
  assert.equal(saved.cvText, cv); assert.equal(saved.goals, "Research");
});

test("real ZIP roundtrip restores live and deleted attachments, history, reminders, profile and CV; repeat restore is additive", async () => {
  const e = (await create({ jd: "First archived JD", academic: 7 })).entry;
  const revised = await patchEntry(e.id, e.revision, { summary: "Changed summary" });
  const attachment = new FormData(); attachment.append("entryId", e.id); attachment.append("file", new File(["Attachment bytes"], "proof.txt"));
  const uploaded = await request("/api/desk", { method: "POST", body: attachment }); assert.equal(uploaded.status, 200);
  const { id: fileId } = await uploaded.json();
  await deleteEntry(e.id, revised.revision);
  const live = (await create({ title: "[test] live attached record" })).entry;
  const liveForm = new FormData(); liveForm.append("entryId", live.id); liveForm.append("file", new File(["Live attachment"], "live.txt"));
  assert.equal((await request("/api/desk", { method: "POST", body: liveForm })).status, 200);
  const reminderId = randomUUID();
  await post("/api/reminders", { action: "save", reminder: { id: reminderId, title: "Roundtrip reminder", schedule: { type: "daily", time: "08:00" }, entryId: live.id, revision: 0 } });
  await post("/api/reminders", { action: "done", id: reminderId, day: "2025-01-01", done: true });
  const archive = readArchive(await exportArchive(request));
  assert(archive.manifest.entries.find(row => row.id === e.id)?.deletedAt);
  assert(archive.manifest.personal?.done.some(row => row.day === "2025-01-01"));
  const originalCv = archive.manifest.personal!.profile.cv!;
  // Simulate an empty instance using only the explicitly isolated test database.
  await pool.query("TRUNCATE entries, reminders, documents, company_watches, part_time_records, meta CASCADE");
  for (const file of archive.manifest.files) await localFiles.delete(file.id);
  await localFiles.delete(originalCv.id);
  assert.deepEqual(await restoreArchive(archive, request), { orphaned: 0 });
  const restored = readArchive(await exportArchive(request));
  assert.deepEqual(restored.manifest.entries, archive.manifest.entries);
  assert.deepEqual(restored.manifest.versions, archive.manifest.versions);
  assert.deepEqual(restored.manifest.personal!.reminders, archive.manifest.personal!.reminders);
  assert.deepEqual(restored.manifest.personal!.done, archive.manifest.personal!.done);
  assert.equal(restored.manifest.personal!.cvBase64, archive.manifest.personal!.cvBase64);
  assert.deepEqual({ ...restored.manifest.personal!.profile, cv: originalCv }, archive.manifest.personal!.profile);
  for (const f of archive.manifest.files) assert.deepEqual(restored.files["files/" + f.id], archive.files["files/" + f.id]);
  assert.equal(await (await request("/api/desk?file=" + fileId)).text(), "Attachment bytes");
  const cvResponse = await request("/api/profile/cv"); assert.equal(cvResponse.status, 200);
  assert.equal(await cvResponse.text(), archive.manifest.personal!.profile.cvText);
  await patchEntry(live.id, live.revision, { title: "Preserve current title" });
  const profile = restored.manifest.personal!.profile;
  await post("/api/enrichment", { action: "profile", profile: { ...profile, goals: "Preserve current goals" } });
  await post("/api/reminders", { action: "done", id: reminderId, day: "2025-01-01", done: false });
  await restoreArchive(archive, request);
  assert.equal((await getEntry(live.id))!.title, "Preserve current title");
  const personal = await (await request("/api/backup")).json();
  assert.equal(personal.profile.goals, "Preserve current goals");
  assert(!personal.done.some((d: { reminder_id: string }) => d.reminder_id === reminderId));
});

test("legacy ZIP orphan attachment is reported while later records still restore", async () => {
  const live = { ...blankEntry("job"), title: "[test] legacy restore" };
  const watch = { id: randomUUID(), company: "Legacy company", url: "https://example.com/jobs", revision: 0 };
  // Export a valid watch schema from the API instead of depending on defaults here.
  await post("/api/watches", { action: "save", watch });
  const full = await (await request("/api/desk?export=1")).json();
  const exportedWatch = full.watches.find((w: { id: string }) => w.id === watch.id);
  await pool.query("DELETE FROM company_watches WHERE id=$1", [watch.id]);
  const manifest = { format: "opportunity-desk-v1", entries: [live], files: [{ id: randomUUID(), entry_id: randomUUID(), name: "orphan.txt", type: "text/plain", size: 6, created: new Date().toISOString() }], versions: [], watches: [exportedWatch] };
  const zip = zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ["files/" + manifest.files[0].id]: strToU8("orphan") });
  assert.deepEqual(await restoreArchive(readArchive(zip), request), { orphaned: 1 });
  assert(await getEntry(live.id));
  assert.equal((await pool.query("SELECT 1 FROM company_watches WHERE id=$1", [watch.id])).rowCount, 1);
});

test("personal backup rejects unauthenticated, foreign-origin and malformed restores before writes", async () => {
  assert.equal((await fetch(base + "/api/backup")).status, 401);
  assert.equal((await fetch(base + "/api/backup", { method: "POST", headers: { cookie, origin: "https://other.example", "content-type": "application/json" }, body: "{}" })).status, 403);
  const before = await (await request("/api/backup")).json();
  const invalid = { ...before, reminders: [...before.reminders, { id: randomUUID(), title: "Must not be written", schedule: { type: "weekly", days: [] } }] };
  const response = await request("/api/backup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invalid) });
  assert.equal(response.status, 400);
  assert.deepEqual(await (await request("/api/backup")).json(), before);
});
