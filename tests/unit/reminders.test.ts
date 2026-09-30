import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSchedule, occursOn, reminderSaveSchema, reminderSchema } from "../../lib/reminder-schema";
import { watchSchema, blankWatch } from "../../lib/watches";

test("reminders occur on the right days", () => {
  // 2026-09-28 is a Monday.
  assert(occursOn({ type: "daily", time: "08:00", until: "" }, "2026-09-28"));
  assert(!occursOn({ type: "daily", time: "08:00", until: "2026-09-27" }, "2026-09-28"));
  assert(occursOn({ type: "weekly", days: [1, 3], time: "", until: "" }, "2026-09-28"));
  assert(!occursOn({ type: "weekly", days: [6, 7], time: "", until: "" }, "2026-09-28"));
  assert(occursOn({ type: "weekly", days: [7], time: "", until: "" }, "2026-10-04"));
  assert(occursOn({ type: "once", date: "2026-09-28", time: "" }, "2026-09-28"));
  assert(!occursOn({ type: "once", date: "2026-09-29", time: "" }, "2026-09-28"));
});
test("schedules read naturally", () => {
  assert.equal(describeSchedule({ type: "daily", time: "08:00", until: "" }), "每天 08:00");
  assert.equal(describeSchedule({ type: "weekly", days: [5, 1, 2, 3, 4], time: "", until: "2026-12-31" }), "工作日，到 2026-12-31");
  assert.equal(describeSchedule({ type: "weekly", days: [6, 7], time: "10:00", until: "" }), "周末 10:00");
  assert.equal(describeSchedule({ type: "weekly", days: [2, 4], time: "", until: "" }), "每周二、四");
  assert.equal(describeSchedule({ type: "once", date: "2026-10-01", time: "" }), "2026-10-01");
});
test("reminder and watch schemas reject bad input", () => {
  const base = { id: "r1", title: "Do it", schedule: { type: "daily", time: "08:00" } };
  assert(reminderSchema.safeParse(base).success);
  assert(!reminderSchema.safeParse({ ...base, title: " " }).success);
  assert(!reminderSchema.safeParse({ ...base, url: "javascript:alert(1)" }).success);
  assert(!reminderSchema.safeParse({ ...base, schedule: { type: "weekly", days: [8], time: "" } }).success);
  const watch = { ...blankWatch(), company: "Test company", url: "https://example.com/jobs", regions: ["中国香港"], enabled: false };
  assert.deepEqual(watchSchema.parse(watch), watch);
  assert.equal(watchSchema.parse({ ...watch, kind: undefined }).kind, "company", "older watches default to company pages");
  assert(!watchSchema.safeParse({ ...watch, url: "javascript:alert(1)" }).success);
  assert(!watchSchema.safeParse({ ...watch, regions: ["invalid"] }).success);
  assert(!watchSchema.safeParse({ ...watch, kind: "rss" }).success);
});
test("saving a reminder drops derived list fields without weakening its stored schema", () => {
  const reminder = { id: "r1", title: "Do it", schedule: { type: "daily", time: "08:00" } as const };
  assert.deepEqual(reminderSaveSchema.parse({ ...reminder, description: "每天 08:00", done: false }), reminderSchema.parse(reminder));
  assert(!reminderSchema.safeParse({ ...reminder, description: "每天 08:00", done: false }).success);
});
