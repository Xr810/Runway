// End-to-end API tests against a running server and its PostgreSQL database.
//   BASE_URL (default http://localhost:3000), TEST_ORIGIN, DATABASE_URL, and tests/mock-ai.mjs on port 4010.
//   SCAN_LIVE=1 also runs a real scan against a public Greenhouse board.
// Records created here are titled "[test] …" and removed at the end.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { zipSync, strToU8 } from "fflate";

const base = process.env.BASE_URL || "http://localhost:3000";
const origin = process.env.TEST_ORIGIN || new URL(base).origin;
const aiBase = process.env.TEST_AI_BASE_URL || "http://127.0.0.1:4010";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const password = "Runway-test-" + randomUUID() + "!";
const accounts = {
  a: { email: `runway-api-a-${randomUUID()}@example.test`, name: "API Test A", cookie: "", id: "" },
  b: { email: `runway-api-b-${randomUUID()}@example.test`, name: "API Test B", cookie: "", id: "" },
};
let active = "a";
const created = { entries: [], reminders: [], watches: [], clients: [] };

async function call(path, { method = "GET", body, form, headers = {}, auth = true } = {}) {
  const response = await fetch(base + path, { method, redirect: "manual",
    headers: { origin, ...(auth && accounts[active].cookie ? { cookie: accounts[active].cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: form ?? (body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)) });
  const type = response.headers.get("content-type") || "";
  return { status: response.status, headers: response.headers, body: type.includes("json") ? await response.json() : await response.text() };
}
async function authenticate(who, action = "login") {
  const account = accounts[who];
  const r = await fetch(base + "/api/auth", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ action, email: account.email, password, displayName: account.name }) });
  assert.equal(r.status, 200, `${action} failed for account ${who}: ${await r.text()}`);
  account.cookie = r.headers.get("set-cookie").split(";")[0];
}
const entry = (patch = {}) => ({ id: randomUUID(), kind: "job", title: "[test] Quant Intern", organization: "Test Co", status: "待投递", location: "Hong Kong", url: "", deadline: "", applied: "", followUp: "", nextAction: "", salary: "", priority: "", applicationChannel: "", applicationUrl: "", appointments: [], progress: [], workMode: "待核实", employmentType: "待核实", schedule: "待核实", companyType: "待核实", companyBasis: "", companySource: "", notes: "", summary: "", jd: "", jdStatus: "missing", jdSavedAt: "", fit: null, career: null, outlook: null, extra: {}, revision: 0, ...patch });
async function create(patch) { const e = entry(patch); const r = await call("/api/desk", { method: "POST", body: { action: "save", entry: e } }); assert.equal(r.status, 200, JSON.stringify(r.body)); created.entries.push(e.id); return r.body.entry; }

async function configureModel(who, model) {
  active = who;
  const current = await call("/api/settings/ai");
  assert.equal(current.status, 200, JSON.stringify(current.body));
  const saved = await call("/api/settings/ai", { method: "POST", body: { action: "save", base: aiBase, apiKey: "test-key", model, revision: current.body.revision } });
  assert.equal(saved.status, 200, `model configuration failed: ${JSON.stringify(saved.body)}`);
}
before(async () => {
  await db.connect();
  await authenticate("a", "register"); await authenticate("b", "register");
  for (const account of Object.values(accounts)) account.id = (await db.query("SELECT account_id AS id FROM password_credentials WHERE email=$1", [account.email])).rows[0].id;
  await db.query("SELECT set_config('runway.user_id',$1,false)", [accounts.a.id]);
  await configureModel("a", "mock-model-a"); await configureModel("b", "mock-model-b"); active = "a";
});
after(async () => {
  for (const id of created.reminders) await db.query("DELETE FROM reminders WHERE id=$1", [id]);
  for (const id of created.watches) { await db.query("DELETE FROM crawl_seen WHERE watch_id=$1", [id]); await db.query("DELETE FROM crawl_runs WHERE watch_id=$1", [id]); await db.query("DELETE FROM company_watches WHERE id=$1", [id]); }
  const ids = [...created.entries, ...(await db.query("SELECT id FROM entries WHERE data->>'title' LIKE '[test]%' OR data->'extra'->>'扫描来源' = '[test] Greenhouse'")).rows.map(r => r.id)];
  for (const table of ["versions", "files", "integration_job_refs"]) await db.query(`DELETE FROM ${table} WHERE entry_id = ANY($1)`, [ids]);
  await db.query("DELETE FROM notifications WHERE entry_id = ANY($1) OR title LIKE '[test]%'", [ids]);
  await db.query("DELETE FROM entries WHERE id = ANY($1)", [ids]);
  for (const id of created.clients) { await db.query("DELETE FROM integration_events WHERE client_id=$1", [id]); await db.query("DELETE FROM integration_clients WHERE id=$1", [id]); }
  // Delete only the two accounts created by this process. RLS requires cleanup to
  // run once per owner; never identify records by broad [test] title patterns alone.
  const tables = ["agent_operations", "agent_jobs", "reminder_done", "crawl_seen", "crawl_runs", "integration_events", "integration_job_refs", "versions", "files", "enrichment_results", "enrichment_tasks", "enrichment_state", "notifications", "ai_cache", "documents", "brand_assets", "part_time_records", "reminders", "company_watches", "integration_clients", "agent_runs", "entries", "meta"];
  for (const account of Object.values(accounts)) {
    await db.query("SELECT set_config('runway.user_id',$1,false)", [account.id]);
    for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) await db.query(`DELETE FROM runway_agent.${table}`);
    for (const table of tables) await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [account.id]);
    await db.query("DELETE FROM rate_limits WHERE key LIKE $1", [`user:${account.id}:%`]);
    await db.query("DELETE FROM accounts WHERE id=$1", [account.id]);
    await rm(path.join(process.env.ATTACHMENTS_DIR || path.resolve("data/attachments"), account.id), { recursive: true, force: true });
  }
  await db.end();
});

test("requests from another origin are refused", async () => {
  const r = await call("/api/desk", { method: "POST", body: { action: "save", entry: entry() }, headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
});
test("disabled accounts cannot bypass AI configuration or execution policy", async () => {
  await db.query("UPDATE accounts SET ai_enabled=false WHERE id=$1", [accounts.a.id]);
  try {
    assert.equal((await call("/api/settings/ai", { method: "POST", body: { action: "test", base: aiBase, apiKey: "test-key", model: "mock-model-a", revision: 1 } })).status, 403);
    assert.equal((await call("/api/ai", { method: "POST", body: { messages: [{ role: "user", text: "添加提醒" }], images: [] } })).status, 403);
    const brief = await call("/api/brief", { method: "POST", body: {} });
    assert.equal(brief.status, 200);
    assert(Array.isArray(brief.body.brief.items));
  } finally { await db.query("UPDATE accounts SET ai_enabled=true WHERE id=$1", [accounts.a.id]); }
});
test("malformed bodies are client errors, not 503", async () => {
  assert.equal((await call("/api/desk", { method: "POST", body: "{not json" })).status, 400);
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "restoreVersions", versions: [{ id: "a", entry_id: "b", data: "{bad", created: "2026-01-01" }] } })).status, 400);
});
test("saving uses optimistic revisions and keeps JD history", async () => {
  const saved = await create({ jd: "First version of the description" });
  assert.equal(saved.revision, 1);
  const stale = await call("/api/desk", { method: "POST", body: { action: "save", entry: { ...saved, revision: 0, title: "[test] stale" } } });
  assert.equal(stale.status, 409);
  const next = await call("/api/desk", { method: "POST", body: { action: "save", entry: { ...saved, jd: "Second version" } } });
  assert.equal(next.body.entry.revision, 2);
  const detail = await call("/api/desk?entry=" + saved.id);
  assert.equal(detail.body.entry.jd, "Second version");
  assert.equal(detail.body.versions.length, 1);
  assert.equal(JSON.parse(detail.body.versions[0].data).jd, "First version of the description");
});
test("the list omits JD text but reports its length", async () => {
  const saved = await create({ jd: "x".repeat(1234) });
  const row = (await call("/api/desk")).body.entries.find(e => e.id === saved.id);
  assert.equal(row.jd, ""); assert.equal(row.jdChars, 1234);
  const full = (await call("/api/desk?export=1")).body.entries.find(e => e.id === saved.id);
  assert.equal(full.jd.length, 1234);
});
test("patch changes a few fields and rejects unknown ones", async () => {
  const saved = await create({ jd: "Keep me" });
  const r = await call("/api/desk", { method: "POST", body: { action: "patch", id: saved.id, revision: saved.revision, patch: { status: "已投递", applied: "2026-09-01" } } });
  assert.equal(r.status, 200); assert.equal(r.body.entry.status, "已投递"); assert.equal(r.body.entry.jd, "Keep me");
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "patch", id: saved.id, revision: r.body.entry.revision, patch: { id: "other" } } })).status, 400);
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "patch", id: saved.id, revision: 1, patch: { status: "笔试" } } })).status, 409);
});
test("delete is soft and can be undone", async () => {
  const saved = await create();
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "delete", id: saved.id, revision: 99 } })).status, 409);
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "delete", id: saved.id, revision: saved.revision } })).status, 200);
  assert(!(await call("/api/desk")).body.entries.some(e => e.id === saved.id));
  assert((await call("/api/desk?deleted=1")).body.entries.some(e => e.id === saved.id));
  assert.equal((await call("/api/desk?entry=" + saved.id)).status, 404);
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "undelete", id: saved.id } })).status, 200);
  assert((await call("/api/desk")).body.entries.some(e => e.id === saved.id));
});
test("reminders appear on their days and can be ticked off", async () => {
  const id = randomUUID(); created.reminders.push(id);
  const reminder = { id, title: "[test] 去 WorldQuant BRAIN 挖因子", schedule: { type: "daily", time: "08:00", until: "" }, revision: 0 };
  const saved = await call("/api/reminders", { method: "POST", body: { action: "save", reminder } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
  assert.equal((await call("/api/reminders?day=" + day)).body.today.find(r => r.id === id)?.done, false);
  await call("/api/reminders", { method: "POST", body: { action: "done", id, day, done: true } });
  assert.equal((await call("/api/reminders?day=" + day)).body.today.find(r => r.id === id)?.done, true);
  assert.equal((await call("/api/reminders", { method: "POST", body: { action: "save", reminder } })).status, 409);
  const weekly = await call("/api/reminders", { method: "POST", body: { action: "save", reminder: { ...reminder, id: randomUUID(), schedule: { type: "weekly", days: [], time: "" } } } });
  assert.equal(weekly.status, 400);
});
test("integration events are idempotent and notify", async () => {
  const client = await call("/api/settings/integrations", { method: "POST", body: { action: "create", name: "[test] Muse" } });
  assert.equal(client.status, 200); created.clients.push(client.body.id);
  const event = { requestId: randomUUID(), action: "create_job", summary: "[test] new job", externalId: randomUUID(), source: { kind: "website", id: "test", occurredAt: new Date().toISOString() }, job: { title: "[test] Integration Analyst", organization: "Test Co " + randomUUID().slice(0, 6), url: "https://example.com/jobs/" + randomUUID() } };
  const send = body => fetch(base + "/api/integrations/v1/events", { method: "POST", headers: { authorization: "Bearer " + client.body.token, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  const first = await send(event);
  assert.equal(first.status, 200, JSON.stringify(first.body)); created.entries.push(first.body.entryId);
  const replay = await send(event);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.entryId, first.body.entryId);
  assert.equal((await send({ ...event, summary: "changed" })).status, 409);
  const notices = await call("/api/notifications?history=true");
  assert(notices.body.items.some(n => n.id === first.body.notificationId));
});
test("reading enrichment state does not write", async () => {
  const count = async () => Number((await db.query("SELECT count(*) FROM enrichment_tasks")).rows[0].count);
  const before = await count(); await call("/api/enrichment"); await call("/api/enrichment");
  assert.equal(await count(), before);
});
test("the assistant proposes a reminder from plain language", async () => {
  const r = await call("/api/ai", { method: "POST", body: { messages: [{ role: "user", text: "每天8点提醒我去 WorldQuant BRAIN 挖因子" }], images: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.runtime, "langgraph");
  assert.equal(r.body.actions.length, 1);
  assert.equal(r.body.actions[0].body.reminder.schedule.type, "daily");
  assert.equal(r.body.actions[0].body.reminder.schedule.time, "08:00");
});
test("the assistant refuses to read private addresses", async () => {
  const r = await call("/api/ai", { method: "POST", body: { messages: [{ role: "user", text: "看看这个岗位 https://127.0.0.1/admin" }], images: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.pages[0].ok, false);
});
test("the daily brief is generated and cached", async () => {
  const r = await call("/api/brief", { method: "POST", body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert(r.body.brief.headline);
  assert.equal((await call("/api/brief")).body.brief.headline, r.body.brief.headline);
});
test("CVs in Markdown, Word and PDF become profile text", async () => {
  const send = async (name, bytes) => { const form = new FormData(); form.append("file", new File([bytes], name)); return call("/api/profile/cv", { method: "POST", form }); };
  const md = await send("cv.md", "# Test Person\n\nQuantitative research intern candidate with Python, statistics and machine learning projects.");
  assert.equal(md.status, 200, JSON.stringify(md.body)); assert(md.body.cv.chars > 40);
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Test Person — Data Science intern, Python, SQL, experimentation and forecasting projects.</w:t></w:r></w:p></w:body></w:document>';
  const docx = zipSync({ "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(xml) });
  const word = await send("cv.docx", docx);
  assert.equal(word.status, 200, JSON.stringify(word.body)); assert.match(word.body.preview, /Data Science intern/);
  const stream = "BT /F1 12 Tf 72 720 Td (Test Person - Machine learning research intern, PyTorch, statistics) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const p = await send("cv.pdf", pdf);
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.match(p.body.preview, /Machine learning research intern/);
  const profile = (await call("/api/enrichment")).body.profile;
  assert.equal(profile.cv.name, "cv.pdf"); assert.match(profile.cvText, /PyTorch/);
  assert.equal((await send("cv.exe", "MZ")).status, 400);
  assert.equal((await call("/api/profile/cv", { method: "POST", body: { action: "remove" } })).status, 200);
  assert.equal((await call("/api/enrichment")).body.profile.cv, null);
});
test("a live scan finds and judges real postings", { skip: !process.env.SCAN_LIVE }, async () => {
  const watch = { id: randomUUID(), kind: "company", company: "[test] Greenhouse", url: "https://job-boards.greenhouse.io/anthropic", enabled: false, locations: [], workModes: [], employmentTypes: [], schedules: [], keywords: "", excludeKeywords: "", notes: "", revision: 0 };
  created.watches.push(watch.id);
  assert.equal((await call("/api/watches", { method: "POST", body: { action: "save", watch } })).status, 200);
  assert.equal((await call("/api/scan", { method: "POST", body: { action: "run", watchIds: [watch.id] } })).status, 200);
  let run;
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 3000)); run = (await call("/api/scan")).body.lastRuns[watch.id]; if (run && run.status !== "running") break; }
  assert.equal(run.status, "ok", run.error); assert(run.found > 0); assert(run.added <= 5);
});
test("accounts isolate entries, exports, attachments, AI settings and integration tokens", async () => {
  active = "a";
  const aEntry = await create({ title: "[test] account A only", jd: "private A export text" });
  const upload = new FormData();
  upload.append("entryId", aEntry.id); upload.append("file", new File(["private attachment A"], "a-private.txt", { type: "text/plain" }));
  const uploaded = await call("/api/desk", { method: "POST", form: upload });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  const aClient = await call("/api/settings/integrations", { method: "POST", body: { action: "create", name: "[test] account A token" } });
  assert.equal(aClient.status, 200, JSON.stringify(aClient.body)); created.clients.push(aClient.body.id);

  active = "b";
  const bEntry = await create({ title: "[test] account B only", jd: "private B export text" });
  assert.equal((await call(`/api/desk?entry=${aEntry.id}`)).status, 404);
  const bExport = await call("/api/desk?export=1");
  assert.equal(bExport.status, 200); assert(!bExport.body.entries.some(e => e.id === aEntry.id));
  assert(bExport.body.entries.some(e => e.id === bEntry.id && e.jd === "private B export text"));
  assert(!bExport.body.files.some(f => f.id === uploaded.body.id));
  assert.equal((await call(`/api/desk?file=${uploaded.body.id}`)).status, 404);
  const bSettings = await call("/api/settings/ai");
  assert.equal(bSettings.body.model, "mock-model-b");
  const bClient = await call("/api/settings/integrations", { method: "POST", body: { action: "create", name: "[test] account B token" } });
  assert.equal(bClient.status, 200, JSON.stringify(bClient.body));

  const tokenEntries = async token => {
    const response = await fetch(base + "/api/integrations/v1/entries", { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  };
  const viaA = await tokenEntries(aClient.body.token), viaB = await tokenEntries(bClient.body.token);
  assert.equal(viaA.status, 200); assert(viaA.body.entries.some(e => e.id === aEntry.id)); assert(!viaA.body.entries.some(e => e.id === bEntry.id));
  assert.equal(viaB.status, 200); assert(viaB.body.entries.some(e => e.id === bEntry.id)); assert(!viaB.body.entries.some(e => e.id === aEntry.id));

  active = "a";
  assert.equal((await call("/api/settings/ai")).body.model, "mock-model-a");
  const aExport = await call("/api/desk?export=1");
  assert(aExport.body.entries.some(e => e.id === aEntry.id && e.jd === "private A export text"));
  assert(!aExport.body.entries.some(e => e.id === bEntry.id));
  assert(aExport.body.files.some(f => f.id === uploaded.body.id));
  const downloaded = await call(`/api/desk?file=${uploaded.body.id}`);
  assert.equal(downloaded.status, 200); assert.equal(downloaded.body, "private attachment A");
});
test("save and patch reject ambiguous current recruitment rounds", async () => {
  active = "a";
  const stages = ["first", "second"].map(id => ({ id, title: id, type: "assessment", startsAt: "" }));
  const invalid = await call("/api/desk", { method: "POST", body: { action: "save", entry: entry({ appointments: stages }) } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /当前招聘阶段/);
  const saved = await create({ title: "[test] stage uniqueness", appointments: [{ ...stages[0], stageState: "superseded" }, stages[1]] });
  const patched = await call("/api/desk", { method: "POST", body: { action: "patch", id: saved.id, revision: saved.revision, patch: { appointments: stages } } });
  assert.equal(patched.status, 400);
  assert.match(patched.body.error, /当前招聘阶段/);
  assert.equal((await call(`/api/desk?entry=${saved.id}`)).body.entry.appointments[0].stageState, "superseded");
});
test("attachment upload and backup restore cannot cross account boundaries", async () => {
  active = "a";
  const aEntry = await create({ title: "[test] restore isolation A", jd: "A original" });
  const updated = await call("/api/desk", { method: "POST", body: { action: "save", entry: { ...aEntry, jd: "A current" } } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const aUpload = new FormData();
  aUpload.append("entryId", aEntry.id); aUpload.append("file", new File(["A restore attachment"], "restore-a.txt", { type: "text/plain" }));
  const uploaded = await call("/api/desk", { method: "POST", form: aUpload });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  const backup = await call("/api/desk?export=1");
  const aVersion = backup.body.versions.find(v => v.entry_id === aEntry.id);
  assert(aVersion, "account A export should contain its version history");

  active = "b";
  const bEntry = await create({ title: "[test] restore isolation B" });
  const foreignTarget = new FormData();
  foreignTarget.append("entryId", aEntry.id); foreignTarget.append("file", new File(["B must not attach this"], "foreign.txt"));
  assert.equal((await call("/api/desk", { method: "POST", form: foreignTarget })).status, 404);

  const foreignRestore = await call("/api/desk", { method: "POST", body: { action: "restore", entry: backup.body.entries.find(e => e.id === aEntry.id) } });
  assert.notEqual(foreignRestore.status, 200, "account B must not claim or overwrite account A's entry ID");
  assert.equal((await call("/api/desk", { method: "POST", body: { action: "restoreVersions", versions: [aVersion] } })).status, 200);
  assert(!(await call(`/api/desk?entry=${bEntry.id}`)).body.versions.some(v => v.id === aVersion.id));

  const restoredId = randomUUID(), bUpload = new FormData();
  bUpload.append("entryId", bEntry.id); bUpload.append("restoreId", restoredId); bUpload.append("created", "2026-01-02T03:04:05.000Z");
  bUpload.append("file", new File(["B restored attachment"], "restore-b.txt", { type: "text/plain" }));
  assert.equal((await call("/api/desk", { method: "POST", form: bUpload })).status, 200);
  assert.equal((await call(`/api/desk?file=${restoredId}`)).body, "B restored attachment");

  active = "a";
  const stillA = await call(`/api/desk?entry=${aEntry.id}`);
  assert.equal(stillA.status, 200); assert.equal(stillA.body.entry.jd, "A current");
  assert(stillA.body.versions.some(v => v.id === aVersion.id));
  assert.equal((await call(`/api/desk?file=${uploaded.body.id}`)).body, "A restore attachment");
  const finalAExport = await call("/api/desk?export=1");
  assert(!finalAExport.body.entries.some(e => e.id === bEntry.id));
  assert(!finalAExport.body.files.some(f => f.id === restoredId));
});
test("AI run reads, listings and operations are isolated by account", async () => {
  active = "a";
  const proposed = await call("/api/ai", { method: "POST", body: { messages: [{ role: "user", text: "每天10点提醒我检查隔离测试" }], images: [] } });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  const { runId } = proposed.body;
  assert((await call("/api/ai?runs=1")).body.runs.some(r => r.id === runId));

  active = "b";
  const bRuns = await call("/api/ai?runs=1");
  assert.equal(bRuns.status, 200); assert(!bRuns.body.runs.some(r => r.id === runId));
  const endpoint = `/api/ai/runs/${runId}`;
  assert.equal((await call(endpoint)).status, 404);
  assert.equal((await call(endpoint, { method: "POST", body: { action: "recover" } })).status, 404);
  assert.equal((await call(endpoint, { method: "POST", body: { action: "decide", decision: { proposalId: proposed.body.actions[0].id, approved: false } } })).status, 404);

  active = "a";
  const unchanged = await call(endpoint);
  assert.equal(unchanged.status, 200); assert.equal(unchanged.body.runId, runId);
  assert.deepEqual(unchanged.body.outcomes, {});
});
test("signing out everywhere invalidates existing sessions", async () => {
  active = "a";
  const old = accounts.a.cookie;
  assert.equal((await call("/api/auth", { method: "POST", body: { action: "logout-all" } })).status, 200);
  accounts.a.cookie = old;
  assert.equal((await call("/api/desk")).status, 401);
  active = "b";
  assert.equal((await call("/api/desk")).status, 200, "account A logout-all must not revoke account B sessions");
  await authenticate("a"); active = "a";
  assert.equal((await call("/api/desk")).status, 200);
});

test("LangGraph confirmation is server-owned, authenticated and idempotent", async () => {
  active = "a"; await authenticate("a");
  const proposed = await call("/api/ai", { method: "POST", body: { messages: [{ role: "user", text: "每天9点提醒我检查测试记录" }], images: [] } });
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  const { runId, actions } = proposed.body, draft = actions[0];
  const id = draft.body.reminder.id; created.reminders.push(id);
  assert.equal((await db.query("SELECT 1 FROM reminders WHERE id=$1", [id])).rowCount, 0);
  const endpoint = `/api/ai/runs/${runId}`, body = { action: "decide", decision: { proposalId: draft.id, approved: true } };
  assert.equal((await call(endpoint, { method: "POST", body, auth: false })).status, 401);
  assert.equal((await call(endpoint, { method: "POST", body, headers: { origin: "https://invalid.example" } })).status, 403);
  assert.equal((await call(endpoint, { method: "POST", body: { ...body, payload: { title: "forged" } } })).status, 400);
  assert.equal((await call(endpoint, { method: "POST", body: { action: "decide", decision: { proposalId: randomUUID(), approved: true } } })).status, 400);
  assert.equal((await call(endpoint, { method: "POST", body })).body.outcomes[draft.id].status, "done");
  assert.equal((await call(endpoint, { method: "POST", body })).body.outcomes[draft.id].status, "done");
  assert.equal((await db.query("SELECT revision FROM reminders WHERE id=$1", [id])).rows[0].revision, 1);
  assert.equal((await call(endpoint)).body.outcomes[draft.id].status, "done");
});
