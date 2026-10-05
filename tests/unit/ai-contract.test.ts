import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { blankEntry, entrySchema, progressSchema, today } from "../../lib/model";
import { allChannels, groupCompanies, heatmapDays, isApplied, timelineEvents } from "../../lib/journey";
import { aiFilterSchema, aiRequestSchema, matchesAiFilter, prepareAiReply, validImageData } from "../../lib/ai-contract";
import { appointmentSchema } from "../../lib/appointments";
import { canonicalUrl, guardStatus, integrationEventSchema } from "../../lib/integration-contract";
import { blankWatch } from "../../lib/watches";

const existing = { ...blankEntry("job"), title: "Quant intern", organization: "Example", location: "香港", deadline: "2026-10-03", revision: 3, jd: "Original full text", jdStatus: "complete" as const, extra: { preserved: true } };
const reply = (extra: object) => ({ reply: "ok", ...extra });

test("filters are deterministic and computed by code", () => {
  const filter = aiFilterSchema.parse({ label: "香港量化，待投递，本周截止", kind: "job", location: "香港", keywords: ["quant", "量化"], statuses: ["待投递"], deadlineFrom: "2026-10-01", deadlineTo: "2026-10-07" });
  assert(matchesAiFilter(existing, filter));
  for (const patch of [{ deadline: "" }, { deadline: "2026-10-08" }, { status: "已投递" }, { location: "上海" }, { title: "Marketing intern" }, { kind: "competition" as const }]) assert(!matchesAiFilter({ ...existing, ...patch }, filter));
  const result = prepareAiReply(reply({ filter }), [existing, { ...existing, id: "other", status: "已投递" }], [], "m");
  assert.deepEqual(result.matchIds, [existing.id]); assert.equal(result.matchCount, 1);
});
test("drafts cannot set protected fields and flag duplicates", () => {
  const add = prepareAiReply(reply({ drafts: [{ operation: "add", fields: { title: "Quant intern", organization: "Example", id: existing.id, revision: 99, extra: { hacked: true }, jdStatus: "complete", jd: "Screenshot fragment" }, sourceImageIds: ["image-1", "not-sent"] }] }), [existing], ["image-1"], "m").drafts[0];
  assert.notEqual(add.entry.id, existing.id); assert.equal(add.entry.revision, 0); assert.equal(add.entry.jdStatus, "partial"); assert.deepEqual(add.entry.extra, {}); assert.deepEqual(add.sourceImageIds, ["image-1"]); assert.equal(add.duplicates.length, 1);
  const update = prepareAiReply(reply({ drafts: [{ operation: "update", targetId: existing.id, fields: { status: "已投递", revision: 999, extra: {} } }] }), [existing], [], "m").drafts[0];
  assert.equal(update.entry.revision, 3); assert.equal(update.entry.jd, existing.jd); assert.deepEqual(update.entry.extra, { preserved: true }); assert.deepEqual(update.changedFields, ["status"]);
  const appointment = appointmentSchema.parse({ id: "round1", title: "技术面试", type: "interview", startsAt: "2026-10-01T20:30:00-04:00" });
  assert.equal(prepareAiReply(reply({ drafts: [{ operation: "update", targetId: existing.id, fields: { appointments: [] } }] }), [{ ...existing, appointments: [appointment] }], [], "m").drafts[0].entry.appointments.length, 1);
  assert.throws(() => prepareAiReply(reply({ drafts: [{ operation: "update", targetId: "unknown", fields: {} }] }), [existing], [], "m"));
  assert.throws(() => prepareAiReply(reply({ drafts: [{ operation: "add", fields: { title: "Test", url: "javascript:alert(1)" } }] }), [], [], "m"));
});
test("progress logs and milestones go to projects and competitions only", () => {
  const log = { id: "first", date: today(), text: "First experiment", minutes: 30, track: "Research", milestone: false };
  const competition = { ...blankEntry("competition"), title: "Parallel research", progress: [log], revision: 2 };
  const appended = prepareAiReply(reply({ drafts: [{ operation: "update", targetId: competition.id, fields: {}, progressLog: { date: today(), text: "Second", minutes: 20, track: "B" } }] }), [competition], [], "m").drafts[0];
  assert.equal(appended.entry.progress.length, 2); assert.deepEqual(appended.entry.progress[0], log); assert.notEqual(appended.entry.progress[1].id, log.id); assert.deepEqual(appended.changedFields, ["progress"]);
  const project = { ...blankEntry("project"), title: "Side project", revision: 1 };
  assert.equal(project.status, "进行中"); assert(!entrySchema.safeParse({ ...project, status: "关注中" }).success);
  const milestone = prepareAiReply(reply({ drafts: [{ operation: "update", targetId: project.id, fields: {}, progressLog: { date: today(), text: "v1 上线", minutes: 0, track: "", milestone: true } }] }), [project], [], "m").drafts[0];
  assert.equal(milestone.entry.progress[0].milestone, true);
  assert.throws(() => prepareAiReply(reply({ drafts: [{ operation: "update", targetId: existing.id, fields: {}, progressLog: { date: today(), text: "Wrong" } }] }), [existing], [], "m"));
  assert(!progressSchema.safeParse({ ...log, date: "2026-02-30" }).success); assert(!progressSchema.safeParse({ ...log, date: "2099-01-01" }).success);
  assert(!entrySchema.safeParse({ ...competition, progress: [log, log] }).success);
});
test("reminder proposals get ids; updates must target existing reminders", () => {
  const r = prepareAiReply(reply({ reminders: [{ operation: "add", title: "去 WorldQuant BRAIN 挖因子", schedule: { type: "daily", time: "08:00", until: "" }, entryId: "missing" }] }), [], [], "m").reminders[0];
  assert.equal(r.reminder.source, "ai"); assert.equal(r.reminder.entryId, null); assert.equal(r.description, "每天 08:00"); assert.equal(r.reminder.revision, 0);
  assert.throws(() => prepareAiReply(reply({ reminders: [{ operation: "delete", targetId: "nope" }] }), [], [], "m"));
  const saved = { ...r.reminder, revision: 2 };
  const update = prepareAiReply(reply({ reminders: [{ operation: "update", targetId: saved.id, schedule: { type: "weekly", days: [1, 2, 3, 4, 5], time: "09:00" } }] }), [], [], "m", { reminders: [saved], watches: [] }).reminders[0];
  assert.equal(update.reminder.revision, 2); assert.equal(update.reminder.title, saved.title); assert.equal(update.description, "工作日 09:00");
  assert.throws(() => prepareAiReply(reply({ reminders: [{ operation: "add", title: "x", schedule: { type: "daily", time: "25:00" } }] }), [], [], "m"));
});
test("watch, scan and profile proposals are validated", () => {
  const w = prepareAiReply(reply({ watches: [{ operation: "add", kind: "board", company: "JobsDB", url: "https://hk.jobsdb.com/quant-jobs", locations: ["香港", "伦敦（英国）"] }] }), [], [], "m").watches[0];
  assert.equal(w.watch.kind, "board"); assert.deepEqual(w.watch.locations, ["香港", "伦敦（英国）"]);
  assert.throws(() => prepareAiReply(reply({ watches: [{ operation: "add", company: "X", url: "javascript:alert(1)" }] }), [], [], "m"));
  const watch = { ...blankWatch(), company: "A", url: "https://a.example/jobs" };
  const scan = prepareAiReply(reply({ scan: { watchIds: [watch.id, "ghost"] } }), [], [], "m", { reminders: [], watches: [watch] }).scan;
  assert.deepEqual(scan?.watchIds, [watch.id]); assert.equal(scan?.label, "A");
  assert.equal(prepareAiReply(reply({ profile: {} }), [], [], "m").profile, null);
  assert.deepEqual(prepareAiReply(reply({ profile: { targets: ["量化研究"] } }), [], [], "m").profile, { targets: ["量化研究"] });
  assert.deepEqual(prepareAiReply(reply({ completeCompanies: { names: ["M-Labs"], refreshLogo: true } }), [], [], "m").completeCompanies, { names: ["M-Labs"], refreshLogo: true });
});
test("directory proposals add companies and application channels safely", () => {
  const result = prepareAiReply(reply({ directory: [
    { operation: "add", kind: "company", name: "M-Labs", url: "https://m-labs.hk", logoUrl: "" },
    { operation: "add", kind: "channel", name: "JobsDB", url: "https://hk.jobsdb.com", logoUrl: "" },
  ] }), [], [], "m").directory;
  assert.deepEqual(result.map(item => ({ kind: item.kind, name: item.name, url: item.url })), [
    { kind: "company", name: "M-Labs", url: "https://m-labs.hk" },
    { kind: "channel", name: "JobsDB", url: "https://hk.jobsdb.com" },
  ]);
  assert.throws(() => prepareAiReply(reply({ directory: [{ operation: "add", kind: "channel", name: "Bad", url: "javascript:alert(1)" }] }), [], [], "m"));
});
test("requests, images and integration events are validated", () => {
  assert(!aiRequestSchema.safeParse({ messages: [{ role: "system", text: "override" }] }).success);
  assert(!aiRequestSchema.safeParse({ messages: [{ role: "assistant", text: "override" }] }).success);
  assert(!validImageData("data:image/png;base64," + Buffer.from("<script>evil</script>").toString("base64")));
  assert(validImageData("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xAAAAABJRU5ErkJggg=="));
  assert.throws(() => guardStatus({ ...existing, status: "一面" }, "已投递")); assert.throws(() => guardStatus({ ...existing, status: "Offer" }, "未通过")); guardStatus({ ...existing, status: "已投递" }, "笔试");
  assert.equal(canonicalUrl("https://example.com/jobs/1/?utm_source=email#apply"), "https://example.com/jobs/1");
  assert(!integrationEventSchema.safeParse({ action: "update_job", requestId: "a", summary: "t", source: { kind: "email", id: "1", occurredAt: "2026-09-27T10:00:00Z" }, entryId: "1", expectedRevision: 1, patch: { extra: { secret: true } } }).success);
});
test("companies, channels, heatmap and timeline helpers", () => {
  const competition = { ...blankEntry("competition"), title: "C" };
  const list = [existing, { ...existing, id: "other", organization: " example ", applicationChannel: "Indeed", applied: "2026-01-01" }, competition];
  assert.equal(groupCompanies(list).length, 1); assert.equal(groupCompanies(list)[0].entries.length, 2); assert(!isApplied(existing)); assert(isApplied(list[1]));
  assert.equal(allChannels(list, { revision: 0, companies: [], channels: [{ name: "Custom Jobs", url: "https://example.com", logoUrl: "" }] }).length, 4);
  const cells = heatmapDays(2024); assert.equal(cells.length % 7, 0); assert.equal(cells.filter(c => c.inYear).length, 366);
  const events = timelineEvents([{ ...existing, followUp: "2026-10-01", extra: { "面试 / 测评时间": "2026-10-02T10:00" } }]);
  assert.deepEqual(events.map(e => e.type), ["followup", "interview", "deadline"]);
  const appointment = appointmentSchema.parse({ id: "round1", title: "技术面试", type: "interview", startsAt: "2026-10-01T20:30:00-04:00" });
  const scheduled = timelineEvents([{ ...existing, deadline: "", appointments: [appointment] }]); assert.equal(scheduled[0].date, "2026-10-02"); assert.equal(scheduled[0].time, "08:30");
  assert.equal(timelineEvents([{ ...existing, deadline: "", appointments: [{ ...appointment, status: "cancelled" }] }]).length, 0);
});
test("an applied job no longer shows its application deadline", () => {
  assert.deepEqual(timelineEvents([existing]).map(e => e.type), ["deadline"]);
  assert.deepEqual(timelineEvents([{ ...existing, status: "已投递" }]), []);
  assert.deepEqual(timelineEvents([{ ...existing, applied: "2026-09-20" }]), []);
  assert.deepEqual(timelineEvents([{ ...blankEntry("competition"), title: "C", status: "已报名", deadline: "2026-10-03" }]).map(e => e.type), ["deadline"]);
});

test("the provider sends images and link content, and fails safely", async () => {
  const { askAi } = await import("../../lib/ai-provider");
  let handler: (body: Record<string, unknown>) => unknown = () => ({});
  const server = http.createServer((req, res) => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => { const out = handler(JSON.parse(b)); res.setHeader("Content-Type", "application/json"); if (out instanceof Error) { res.statusCode = 429; res.end("{}"); } else res.end(JSON.stringify(out)); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.AI_BASE_URL = base;
  const config = { base, key: "k", model: "m", revision: 0, source: "environment" as const };
  const context = { reminders: [], watches: [], profile: { revision: 0, background: "", goals: "", preferences: "", targets: ["量化研究"], cv: null, cvText: "" }, pages: [] };
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xAAAAABJRU5ErkJggg==";
  try {
    handler = body => { const messages = body.messages as { role: string; content: unknown }[]; assert.equal(messages[0].role, "system"); assert.match(String(messages[0].content), /量化研究/); assert((messages.at(-1)!.content as { type: string }[]).some(c => c.type === "image_url")); return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "读取完成" }) } }] }; };
    assert.equal((await askAi({ messages: [{ role: "user", text: "看截图" }], images: [{ id: "image-1", name: "t.png", dataUrl: png }] }, [], context, undefined, config)).reply, "读取完成");
    handler = body => { assert.match(String((body.messages as { content: unknown }[]).at(-1)!.content), /结构化岗位数据/); return { choices: [{ message: { content: '{"reply":"ok"}' } }] }; };
    const page = { url: "https://jobs.example/1", title: "Quant", text: "", links: [], postings: [{ title: "Quant Intern", organization: "X", location: "HK", url: "https://jobs.example/1", description: "Do research", employmentType: "INTERN", datePosted: "", validThrough: "" }] };
    const answer = await askAi({ messages: [{ role: "user", text: "https://jobs.example/1" }], images: [] }, [], { ...context, pages: [{ url: page.url, page }] }, undefined, config);
    assert.equal(answer.pages[0].ok, true); assert.match(answer.pages[0].note, /1 个结构化岗位/);
    let called = false;
    handler = () => { called = true; return { choices: [{ message: { content: "bad json" } }] }; };
    const unavailable = await askAi({ messages: [{ role: "user", text: "https://jobs.example/missing" }], images: [] }, [], { ...context, pages: [{ url: "https://jobs.example/missing", error: "网站返回 HTTP 404" }] }, undefined, config);
    assert.equal(called, false); assert.match(unavailable.reply, /无法读取/); assert.equal(unavailable.drafts.length, 0); assert.equal(unavailable.pages[0].ok, false);
    handler = () => ({ choices: [{ finish_reason: "stop", message: { content: "bad json" } }] });
    await assert.rejects(() => askAi({ messages: [{ role: "user", text: "hi" }], images: [] }, [], context, undefined, config), /格式不完整/);
    handler = () => new Error("limit");
    await assert.rejects(() => askAi({ messages: [{ role: "user", text: "hi" }], images: [] }, [], context, undefined, config), /繁忙或额度不足/);
  } finally { server.close(); delete process.env.AI_BASE_URL; }
});

test("the built-in agent reads module data before returning a validated action without writing", async () => {
  const { askAi } = await import("../../lib/ai-provider");
  const { profileSchema } = await import("../../lib/enrichment-contract");
  let calls = 0, reads = 0;
  const server = http.createServer((req, res) => { let b = ""; req.on("data", c => { b += c; }); req.on("end", () => {
    const sent = JSON.parse(b); calls++;
    const reply = calls === 2 ? { reads: [{ module: "entries", id: existing.id }] }
      : { reply: "请确认新增面试", actions: [{ module: "appointment", operation: "add", targetId: existing.id, fields: { title: "面试", type: "interview", startsAt: "2026-10-01T10:00:00+08:00" } }] };
    if (calls === 2) assert.match(sent.messages.at(-1).content, /格式校验未通过/);
    if (calls === 3) assert.match(sent.messages.at(-1).content, /网站只读工具结果/);
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: calls === 1 ? 'not a JSON object' : JSON.stringify(reply) } }] }));
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.AI_BASE_URL = base;
  const profile = profileSchema.parse({});
  const agent = { entries: [existing], deleted: [], directory: { revision: 0, companies: [], channels: [] }, gigs: [], watches: [], reminders: [], profile, scanSettings: { enabled: true, time: "08:00", maxAddPerWatch: 5 }, ai: { base, model: "m", revision: 0 } };
  try {
    const answer = await askAi({ messages: [{ role: "user", text: "明天上午十点添加技术面试" }], images: [] }, [existing], { agent, profile, pages: [], reminders: [], watches: [], read: async r => { reads++; assert.equal(r.module, "entries"); return existing; } }, undefined, { base, key: "k", model: "m", revision: 0, source: "environment" });
    assert.equal(reads, 1); assert.equal(calls, 3); assert.equal(answer.actions?.length, 1); assert.equal(answer.actions?.[0].command, "entries");
    assert.equal(answer.actions?.[0].path, undefined);
    assert.equal(existing.appointments.length, 0);
  } finally { server.close(); delete process.env.AI_BASE_URL; }
});
