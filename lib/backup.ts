import { randomUUID } from "node:crypto";
import { pool, tx, locks } from "./postgres";
import { localFiles } from "./files";
import { evaluationProfile } from "./enrichment";
import { listReminders } from "./reminders";
import { personalBackupSchema } from "./backup-contract";

const profileKey = "evaluation-profile-v1";
export async function exportPersonalBackup() {
  const profile = await evaluationProfile();
  const cv = profile.cv ? await localFiles.get(profile.cv.id) : null;
  if (profile.cv && !cv) throw Error("简历原文件缺失，备份未导出");
  const { reminders } = await listReminders();
  const done = (await pool.query("SELECT reminder_id, to_char(day,'YYYY-MM-DD') AS day, done_at FROM reminder_done ORDER BY reminder_id,day")).rows;
  return personalBackupSchema.parse({ profile, cvBase64: cv ? Buffer.from(cv.body).toString("base64") : null,
    reminders: reminders.map(({ description, ...r }) => { void description; return r; }), done });
}

/** Additive restore: existing reminders (including completion history) and profile win. */
export async function restorePersonalBackup(input: unknown) {
  const backup = personalBackupSchema.parse(input);
  const bytes = backup.cvBase64 ? new Uint8Array(Buffer.from(backup.cvBase64, "base64")) : null;
  if (bytes && bytes.length !== backup.profile.cv?.size) throw Error("简历原文件长度与备份不符");
  // Use a fresh storage key so an imported CV can never overwrite any existing file.
  const cvId = bytes ? "cv_" + randomUUID() : null;
  if (bytes && cvId) await localFiles.put(cvId, new Blob([bytes]).stream(), 5 * 1024 * 1024);
  let keepCv = false;
  try {
    const result = await tx(async client => {
      const profile = { ...backup.profile, revision: Math.max(1, backup.profile.revision), cv: backup.profile.cv ? { ...backup.profile.cv, id: cvId! } : null };
      const inserted = await client.query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING key", [profileKey, JSON.stringify(profile)]);
      if (inserted.rowCount && profile.cv) await client.query("INSERT INTO documents(id,kind,name,mime,size,text,created) VALUES($1,'cv',$2,$3,$4,$5,$6)", [cvId, profile.cv.name, profile.cv.mime, profile.cv.size, profile.cvText, profile.cv.uploadedAt]);
      const imported = new Set<string>();
      for (const r of backup.reminders) {
        const added = await client.query(`INSERT INTO reminders(id,title,note,url,schedule,active,entry_id,source,revision)
          VALUES($1,$2,$3,$4,$5,$6,(SELECT id FROM entries WHERE id=$7),$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
        [r.id, r.title, r.note, r.url, JSON.stringify(r.schedule), r.active, r.entryId, r.source, Math.max(1, r.revision)]);
        if (added.rowCount) imported.add(r.id);
      }
      for (const d of backup.done) if (imported.has(d.reminder_id)) await client.query("INSERT INTO reminder_done(reminder_id,day,done_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [d.reminder_id, d.day, d.done_at]);
      return { profileRestored: !!inserted.rowCount, remindersRestored: imported.size };
    }, { lock: locks.enrichment });
    keepCv = result.profileRestored;
    return result;
  } finally { if (cvId && !keepCv) await localFiles.delete(cvId); }
}
