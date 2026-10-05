import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";

if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw Error("Use a disposable runway_backup_test_* database");
const root = await mkdtemp(tmpdir() + "/runway-backup-");
process.env.ATTACHMENTS_DIR = root;
const { pool, controlPool, runAsUser, tx } = await import("../lib/postgres");
const { localFiles } = await import("../lib/files");
const { readBackup, restoreBackup } = await import("../lib/backup");
const { blankEntry } = await import("../lib/model");
const { listDeleted } = await import("../lib/entries");
const { blankWatch } = await import("../lib/watches");
const { newGig } = await import("../lib/part-time-contract");
const a = randomUUID(), b = randomUUID();
await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'backup-a'),($2,'backup-b')", [a, b]);
assert.equal((await controlPool.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0].rolsuper, false);
after(async () => { await pool.end(); await rm(root, { recursive: true, force: true }); });
const entry = { ...blankEntry("project"), id: randomUUID(), title: "Trashed project" };
const attachment = randomUUID(), cvId = "cv_" + randomUUID(), now = new Date().toISOString();
const manifest = { format: "opportunity-desk-v1", entries: [], deleted: [{ ...entry, deletedAt: now }], files: [{ id: attachment, entry_id: entry.id, name: "a.txt", type: "text/plain", size: 6, created: now }], versions: [{ id: randomUUID(), entry_id: entry.id, data: '{"jd":"legacy"}', created: now }], profile: { background: "Imported", cvText: "CV text", cv: { id: cvId, name: "cv.txt", mime: "text/plain", size: 7, chars: 7, uploadedAt: now } }, reminderPreferences: {} };
const archive = (m: unknown, cv = true) => readBackup(new Blob([zipSync({ "manifest.json": strToU8(JSON.stringify(m)), ["files/" + attachment]: strToU8("winner"), ...(cv ? { ["cv/" + cvId]: strToU8("CV text") } : {}) }) as BlobPart]).stream());

test("incomplete CV is rejected before writes", async () => { await assert.rejects(archive(manifest, false), /CV/); });
test("restore includes watches, gigs, reminders and directory settings", async () => {
  const watch = { ...blankWatch(), company: "Example", url: "https://example.com/jobs" };
  const gig = { ...newGig(), title: "Translation" };
  const reminder = { id: randomUUID(), title: "Follow up", schedule: { type: "daily", time: "09:30" } };
  await runAsUser(b, async () => {
    const backup = await archive({ format: manifest.format, entries: [], files: [], versions: [], watches: [watch], partTime: [gig], reminders: [reminder], directory: { companies: [{ name: "Example", website: "https://example.com", logoUrl: "" }], channels: [{ name: "Website", url: "https://example.com", logoUrl: "" }] } });
    await restoreBackup(backup); await restoreBackup(backup);
    assert.equal((await pool.query("SELECT data->>'company' name FROM company_watches")).rows[0].name, "Example");
    assert.equal((await pool.query("SELECT data->>'title' title FROM part_time_records")).rows[0].title, "Translation");
    assert.equal((await pool.query("SELECT title FROM reminders")).rows[0].title, "Follow up");
    assert.equal(JSON.parse((await pool.query("SELECT value FROM meta WHERE key='company-channel-directory-v1'")).rows[0].value).companies[0].name, "Example");
  });
});
test("late failure rolls back rows/settings; successful trash, attachment, CV, history restore replays safely and isolates tenants", async () => {
  const backup = await archive(manifest);
  await runAsUser(a, async () => {
    await pool.query("INSERT INTO meta(key,value) VALUES('existing','keep')");
    await assert.rejects(restoreBackup(backup, async () => { throw Error("injected late failure"); }), /injected/);
    for (const table of ["entries", "files", "versions", "documents"]) assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 0);
    assert.deepEqual((await pool.query("SELECT key,value FROM meta")).rows, [{ key: "existing", value: "keep" }]);
    // Retrying must tolerate identical bytes left by the rolled-back transaction.
    await restoreBackup(backup); await restoreBackup(backup);
    assert.equal((await listDeleted(true))[0].deletedAt, now);
    assert.equal(new TextDecoder().decode((await localFiles.get(attachment))!.body), "winner");
    assert.equal(new TextDecoder().decode((await localFiles.get(cvId))!.body), "CV text");
    for (const table of ["entries", "files", "versions", "documents"]) assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n, 1);
    assert.equal((await pool.query("SELECT value FROM meta WHERE key='existing'")).rows[0].value, "keep");
  });
  await runAsUser(b, async () => { await assert.rejects(restoreBackup(backup)); assert.equal((await pool.query("SELECT count(*)::int n FROM entries")).rows[0].n, 0); assert.equal(await localFiles.get(attachment), null); });
});
test("full export includes over 200 deleted entries while UI stays bounded", async () => {
  await runAsUser(a, async () => {
    await tx(async c => { for (let i = 0; i < 205; i++) { const e = { ...entry, id: randomUUID() }; await c.query("INSERT INTO entries(id,data,revision,updated,deleted_at) VALUES($1,$2,1,now(),now())", [e.id, JSON.stringify(e)]); } });
    assert.equal((await listDeleted()).length, 200); assert.equal((await listDeleted(true)).length, 206);
  });
});
test("forced filesystem interleaving never overwrites winner", async () => {
  await runAsUser(a, async () => {
    const id = randomUUID(); let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const delayed = new ReadableStream<Uint8Array>({ async start(controller) { await gate; controller.enqueue(strToU8("loser")); controller.close(); } });
    const loser = localFiles.put(id, delayed); await localFiles.put(id, new Blob(["winner"]).stream()); resume(); await assert.rejects(loser, { code: "EEXIST" });
    assert.equal(new TextDecoder().decode((await localFiles.get(id))!.body), "winner");
  });
});
test("forced same-ID upload interleaving retains committed winner bytes", async () => {
  const { uploadAttachment } = await import("../lib/attachments");
  await runAsUser(a, async () => {
    const parent = { ...entry, id: randomUUID() }, id = randomUUID();
    await pool.query("INSERT INTO entries(id,data,revision,updated) VALUES($1,$2,1,now())", [parent.id, JSON.stringify(parent)]);
    let resume!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const winnerFile = new File(["winner"], "winner.txt");
    Object.defineProperty(winnerFile, "stream", { value: () => new ReadableStream<Uint8Array>({ async start(controller) { entered(); await gate; controller.enqueue(strToU8("winner")); controller.close(); } }) });
    const winner = uploadAttachment(id, parent.id, winnerFile, now);
    await started;
    const loser = uploadAttachment(id, parent.id, new File(["loser"], "loser.txt"), now);
    await new Promise(resolve => setTimeout(resolve, 30)); resume();
    assert.deepEqual(await winner, { id }); assert.deepEqual(await loser, { id });
    assert.equal((await pool.query("SELECT name FROM files WHERE id=$1", [id])).rows[0].name, "winner.txt");
    assert.equal(new TextDecoder().decode((await localFiles.get(id))!.body), "winner");
  });
});
test("company text persists with revision checks and JD edits no longer create history", async () => {
  const { saveEntry, getEntry } = await import("../lib/entries");
  await runAsUser(a, async () => {
    const saved = (await saveEntry({ ...blankEntry("job"), title: "New fields", companyCountry: "德国", companyDescription: "第一行\n第二行", jd: "Original" })).entry;
    await saveEntry({ ...saved, jd: "Changed" });
    await assert.rejects(saveEntry({ ...saved, companyCountry: "美国" }), /已更新/);
    const actual = (await getEntry(saved.id))!;
    assert.equal(actual.companyCountry, "德国"); assert.equal(actual.companyDescription, "第一行\n第二行");
    assert.equal(actual.jd, "Changed"); assert.equal(actual.jdSavedAt, "");
    assert.equal((await pool.query("SELECT count(*)::int n FROM versions WHERE entry_id=$1", [saved.id])).rows[0].n, 0);
  });
});
