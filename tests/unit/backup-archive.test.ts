import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { readArchive } from "../../lib/backup-archive";
import { personalBackupSchema } from "../../lib/backup-contract";
import { profileSchema } from "../../lib/enrichment-contract";
import { blankEntry } from "../../lib/model";

const zip = (manifest: unknown, files = {}) => zipSync({ "manifest.json": strToU8(JSON.stringify(manifest)), ...files });
const legacy = { format: "opportunity-desk-v1", entries: [{ ...blankEntry("job"), title: "Legacy job" }], files: [], versions: [] };

test("old archives remain readable without personal data", () => {
  const archive = readArchive(zip(legacy));
  assert.equal(archive.manifest.entries[0].title, "Legacy job");
  assert.equal(archive.manifest.personal, undefined);
});
test("new archives require personal data and valid deletion timestamps before restoration", () => {
  assert.throws(() => readArchive(zip({ ...legacy, format: "opportunity-desk-v2" })), /个人数据/);
  assert.throws(() => readArchive(zip({ ...legacy, entries: [{ ...legacy.entries[0], deletedAt: "bad date" }] })));
});
test("truncated attachment data is rejected before any records are written", () => {
  const files = [{ id: "file", entry_id: legacy.entries[0].id, name: "proof.txt", type: "text/plain", size: 4, created: "2026-09-30T00:00:00Z" }];
  assert.throws(() => readArchive(zip({ ...legacy, files }, { "files/file": strToU8("bad") })), /附件缺失或长度不符/);
});
test("CV bytes must match the declared size and reminder completions need a parent", () => {
  const base = { profile: profileSchema.parse({}), cvBase64: null, reminders: [], done: [] };
  assert(personalBackupSchema.safeParse(base).success);
  assert(!personalBackupSchema.safeParse({ ...base, done: [{ reminder_id: "missing", day: "2026-09-30", done_at: "2026-09-30T00:00:00Z" }] }).success);
  assert(!personalBackupSchema.safeParse({ ...base, cvBase64: "YWJj", profile: { ...base.profile, cv: { id: "cv", name: "cv.txt", mime: "text/plain", size: 5, chars: 3, uploadedAt: "2026-09-30T00:00:00Z" } } }).success);
});

test("maximum-size CV can be validated without overflowing the regex stack", () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024, 65);
  const profile = profileSchema.parse({ cv: { id: "cv", name: "cv.txt", mime: "text/plain", size: bytes.length, chars: 60000, uploadedAt: "2026-09-30T00:00:00Z" }, cvText: "A".repeat(60000) });
  assert(personalBackupSchema.safeParse({ profile, cvBase64: bytes.toString("base64"), reminders: [], done: [] }).success);
});
