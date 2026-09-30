// Isolated persistence/worker check. Uses a newly created PostgreSQL schema and removes only that schema.
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes } from "node:crypto";
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
const schema = "agent_test_" + randomBytes(8).toString("hex");
let close: (() => Promise<void>) | undefined;
try {
  const settings = (await admin.query("SELECT key,value FROM meta WHERE key='ai-settings-v1'")).rows;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("options", "-c search_path=" + schema);
  process.env.DATABASE_URL = url.toString();
  await import("./" + "migrate.mjs");
  const { pool } = await import("../lib/postgres"); close = () => pool.end();
  for (const s of settings) await pool.query("INSERT INTO meta(key,value) VALUES($1,$2)", [s.key, s.value]);
  const { blankEntry } = await import("../lib/model");
  const { saveEntry, getEntry, deleteEntry, undeleteEntry } = await import("../lib/entries");
  const { prepareAgentActions } = await import("../lib/agent-contract");
  const { profileSchema } = await import("../lib/enrichment-contract");
  const { saveEvaluationProfile, enrichmentFeed } = await import("../lib/enrichment");
  const { startBuiltinEnrichment } = await import("../lib/builtin-enrichment");
  const { saveDirectory, getDirectory } = await import("../lib/directory-storage");
  const { saveGig, listGigs } = await import("../lib/part-time");
  const { newGig } = await import("../lib/part-time-contract");
  const profile = await saveEvaluationProfile(profileSchema.parse({ background: "Student with Python experience", targets: ["Data analysis"] }));
  const { entry } = await saveEntry({ ...blankEntry("job"), title: "Isolated fixture", jd: "Python data analysis internship" });
  const gig = await saveGig({ ...newGig(), title: "Fixture gig" });
  const snapshot = { entries: [entry], deleted: [], directory: await getDirectory(), gigs: [gig], reminders: [], watches: [], profile, scanSettings: { enabled: true, time: "08:00", maxAddPerWatch: 5 }, ai: { base: "https://example.com/v1", model: "m", revision: 0 } };
  const draft = prepareAgentActions([{ module: "appointment", operation: "add", targetId: entry.id, fields: { title: "Interview", type: "interview", startsAt: "2026-10-05T15:00:00+08:00" } }], snapshot)[0];
  const { entry: next } = await saveEntry((draft.body as { entry: unknown }).entry);
  assert.equal(next.appointments.length, 1); assert.equal(next.jd, entry.jd);
  await assert.rejects(() => saveEntry((draft.body as { entry: unknown }).entry), /已更新/);
  await deleteEntry(next.id, next.revision); assert.equal(await getEntry(next.id), null);
  await undeleteEntry(next.id); assert(await getEntry(next.id));
  const company = prepareAgentActions([{ module: "company", operation: "add", fields: { name: "Fixture", website: "https://example.com" } }], snapshot)[0];
  await saveDirectory((company.body as { directory: never }).directory);
  assert.equal((await getDirectory()).companies[0].website, "https://example.com");
  const archived = prepareAgentActions([{ module: "gig", operation: "update", targetId: gig.id, fields: { archived: true } }], snapshot)[0];
  await saveGig(archived.body); assert((await listGigs())[0].archived);
  const run = await startBuiltinEnrichment("job", { kind: "job", id: entry.id });
  assert.equal(run.started, 1);
  let complete = false;
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const feed = await enrichmentFeed({ kind: "job", id: entry.id });
    if (feed.tasks[0]?.status === "failed") throw Error("Isolated worker failed: " + feed.tasks[0].error);
    if (feed.tasks[0]?.status === "completed") { assert.equal(feed.history[0].actor, "Runway"); assert.equal(feed.history[0].result.kind, "assessment"); complete = true; break; }
  }
  assert(complete, "Worker did not complete in time");
  console.log(JSON.stringify({ passed: true, checks: ["appointment persistence", "stale revision rejection", "delete and restore", "directory", "gig archive", "builtin worker writes result and history"] }));
} finally {
  if (close) await close();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
