import { randomUUID } from "node:crypto";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import { z } from "zod";
import { entrySchema } from "./model";
import { watchSchema } from "./watches";
import { gigSchema } from "./part-time-contract";
import { directorySchema } from "./journey";
import { profileSchema } from "./enrichment-contract";
import { reminderSaveSchema } from "./reminder-schema";
import { reminderPreferencesSchema } from "./reminder-preferences";
import { tx } from "./postgres";
import { localFiles } from "./files";

export const maxBackupBytes = 200 * 1024 * 1024;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const date = z.string().refine((v) => Number.isFinite(Date.parse(v)));
const manifestSchema = z.object({
  format: z.literal("opportunity-desk-v1"),
  entries: z.array(entrySchema),
  deleted: z.array(z.unknown()).default([]),
  files: z.array(
    z.object({
      id,
      entry_id: id,
      name: z.string().max(300),
      type: z.string().max(200),
      size: z
        .number()
        .int()
        .positive()
        .max(15 * 1024 * 1024),
      created: date,
    }),
  ),
  versions: z.array(
    z.object({
      id,
      entry_id: id,
      data: z
        .string()
        .max(500000)
        .transform((v) => JSON.parse(v)),
      created: date,
    }),
  ),
  watches: z.array(watchSchema).default([]),
  partTime: z.array(gigSchema).default([]),
  reminders: z.array(reminderSaveSchema).default([]),
  directory: directorySchema.optional(),
  profile: profileSchema.optional(),
  reminderPreferences: reminderPreferencesSchema.optional(),
});

/** Streaming inflation checks actual output, not attacker-controlled ZIP size headers. */
export async function readBackup(stream: ReadableStream<Uint8Array>) {
  const files: Record<string, Uint8Array> = Object.create(null);
  const completed = new Set<string>();
  let expanded = 0,
    compressed = 0,
    count = 0,
    failure: Error | undefined;
  const unzip = new Unzip((file) => {
    if (
      ++count > 20000 ||
      !/^(manifest\.json|(?:files|cv)\/[a-zA-Z0-9_-]{1,100})$/.test(file.name) ||
      file.name in files
    )
      throw Error("Invalid ZIP member");
    files[file.name] = new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }
      expanded += data.length;
      size += data.length;
      if (
        expanded > maxBackupBytes ||
        size > (file.name === "manifest.json" ? 50 * 1024 * 1024 : 15 * 1024 * 1024)
      ) {
        failure = Error("Expanded backup too large");
        file.terminate();
        return;
      }
      chunks.push(data);
      if (final) {
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        files[file.name] = bytes;
        completed.add(file.name);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      compressed += value.length;
      if (compressed > maxBackupBytes) throw Error("Backup too large");
      for (let offset = 0; offset < value.length; offset += 1024) {
        unzip.push(value.subarray(offset, offset + 1024));
        if (failure) throw failure;
      }
    }
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
    if (completed.size !== count) throw Error("Truncated ZIP member");
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const manifest = manifestSchema.parse(
    JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
  );
  const deleted = manifest.deleted.map((value) => {
    const { deletedAt, ...entry } = z.object({ deletedAt: date }).passthrough().parse(value);
    return { entry: entrySchema.parse(entry), deletedAt };
  });
  const entries = [
    ...manifest.entries.map((entry) => ({ entry, deletedAt: null as string | null })),
    ...deleted,
  ];
  const parents = new Set(entries.map((e) => e.entry.id));
  if (parents.size !== entries.length) throw Error("Duplicate entry ID");
  for (const group of [
    manifest.files,
    manifest.versions,
    manifest.watches,
    manifest.partTime,
    manifest.reminders,
  ])
    if (new Set(group.map((v) => v.id)).size !== group.length) throw Error("Duplicate ID");
  for (const item of [...manifest.files, ...manifest.versions])
    if (!parents.has(item.entry_id)) throw Error("Missing parent entry");
  for (const r of manifest.reminders)
    if (r.entryId && !parents.has(r.entryId)) throw Error("Missing reminder entry");
  for (const f of manifest.files)
    if (files["files/" + f.id]?.length !== f.size) throw Error("Missing or incomplete attachment");
  const cv = manifest.profile?.cv;
  if (
    cv &&
    (!id.safeParse(cv.id).success ||
      cv.size <= 0 ||
      cv.size > 5 * 1024 * 1024 ||
      files["cv/" + cv.id]?.length !== cv.size ||
      manifest.files.some((f) => f.id === cv.id))
  )
    throw Error("Missing or incomplete CV");
  return { manifest, entries, files };
}

export async function restoreBackup(
  backup: Awaited<ReturnType<typeof readBackup>>,
  beforeCommit?: () => Promise<void>,
) {
  const { manifest: m, entries, files } = backup;
  const staged = new Map<string, string>();
  try {
    for (const f of m.files) {
      const stage = randomUUID();
      staged.set(f.id, stage);
      await localFiles.put(stage, new Blob([files["files/" + f.id] as BlobPart]).stream());
    }
    if (m.profile?.cv) {
      const cv = m.profile.cv,
        stage = randomUUID();
      staged.set(cv.id, stage);
      await localFiles.put(stage, new Blob([files["cv/" + cv.id] as BlobPart]).stream());
    }
    // Deliberately non-retrying: publication is irreversible on an uncertain COMMIT.
    await tx(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('backup:' || current_setting('runway.user_id'),0))",
      );
      async function insert(table: string, columns: string[], values: unknown[]) {
        const old = await c.query(`SELECT 1 FROM ${table} WHERE id=$1`, [values[0]]);
        if (old.rowCount) return false;
        // A cross-account global-ID conflict aborts the entire restore, never updates it.
        await c.query(
          `INSERT INTO ${table}(${columns.join(",")}) VALUES(${values.map((_, i) => "$" + (i + 1)).join(",")})`,
          values,
        );
        return true;
      }
      for (const { entry, deletedAt } of entries)
        await insert(
          "entries",
          ["id", "data", "revision", "updated", "deleted_at"],
          [
            entry.id,
            JSON.stringify({ ...entry, revision: 1 }),
            1,
            new Date().toISOString(),
            deletedAt,
          ],
        );
      for (const f of m.files) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "attachment:" + f.id,
        ]);
        const old = (await c.query("SELECT entry_id, size FROM files WHERE id=$1", [f.id])).rows[0];
        if (old) {
          if (old.entry_id !== f.entry_id) throw Error("Attachment parent conflict");
          // Keep existing content, but a metadata row alone is not a complete restore.
          if (!(await localFiles.get(f.id))) {
            if (old.size !== f.size) throw Error("Attachment metadata conflict");
            await localFiles.publish(staged.get(f.id)!, f.id);
          }
          continue;
        }
        await insert(
          "files",
          ["id", "entry_id", "name", "type", "size", "created"],
          [f.id, f.entry_id, f.name, f.type, f.size, f.created],
        );
        await localFiles.publish(staged.get(f.id)!, f.id);
      }
      for (const v of m.versions) {
        const old = (await c.query("SELECT entry_id FROM versions WHERE id=$1", [v.id])).rows[0];
        if (old && old.entry_id !== v.entry_id) throw Error("Version parent conflict");
        await insert(
          "versions",
          ["id", "entry_id", "data", "created"],
          [v.id, v.entry_id, JSON.stringify(v.data), v.created],
        );
      }
      for (const [table, items] of [
        ["company_watches", m.watches],
        ["part_time_records", m.partTime],
      ] as const)
        for (const item of items)
          await insert(
            table,
            ["id", "data", "revision", "updated"],
            [item.id, JSON.stringify({ ...item, revision: 1 }), 1, new Date().toISOString()],
          );
      for (const r of m.reminders)
        await insert(
          "reminders",
          ["id", "title", "note", "url", "schedule", "active", "entry_id", "source", "revision"],
          [
            r.id,
            r.title,
            r.note,
            r.url,
            JSON.stringify(r.schedule),
            r.active,
            r.entryId,
            r.source,
            1,
          ],
        );
      for (const [key, value] of [
        ["company-channel-directory-v1", m.directory],
        ["recruiting-reminders-v1", m.reminderPreferences],
        ["evaluation-profile-v1", m.profile],
      ] as const) {
        if (!value) continue;
        const existing = (await c.query("SELECT value FROM meta WHERE key=$1", [key])).rows[0];
        if (existing) {
          if (key === "evaluation-profile-v1" && m.profile?.cv) {
            const cv = m.profile.cv;
            const current = profileSchema.parse(JSON.parse(existing.value)).cv;
            // Repair only the currently referenced CV, never revert a newer profile/CV.
            if (current?.id === cv.id && !(await localFiles.get(cv.id))) {
              const document = (
                await c.query("SELECT kind, size FROM documents WHERE id=$1", [cv.id])
              ).rows[0];
              if (current.size !== cv.size || document?.kind !== "cv" || document.size !== cv.size)
                throw Error("CV metadata conflict");
              await localFiles.publish(staged.get(cv.id)!, cv.id);
            }
          }
          continue;
        }
        if (key === "evaluation-profile-v1" && m.profile?.cv) {
          const cv = m.profile.cv;
          await insert(
            "documents",
            ["id", "kind", "name", "mime", "size", "text"],
            [cv.id, "cv", cv.name, cv.mime, cv.size, m.profile.cvText],
          );
          await localFiles.publish(staged.get(cv.id)!, cv.id);
        }
        await c.query(
          "INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(user_id,key) DO NOTHING",
          [key, JSON.stringify(value)],
        );
      }
      await beforeCommit?.();
    });
  } finally {
    for (const stage of staged.values()) await localFiles.delete(stage).catch(() => {});
  }
}
