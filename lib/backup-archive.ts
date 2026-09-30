import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { entryObject, entrySchema } from "./model";
import { directorySchema } from "./journey";
import { watchSchema } from "./watches";
import { gigSchema } from "./part-time-contract";
import { personalBackupSchema } from "./backup-contract";
import { readJson } from "./api-response";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const timestamp = z.string().datetime({ offset: true });
const archiveSchema = z.object({
  format: z.enum(["opportunity-desk-v1", "opportunity-desk-v2"]),
  entries: z.array(entryObject.extend({ deletedAt: timestamp.nullable().optional() }).refine(e => entrySchema.safeParse(e).success, "备份记录无效")),
  files: z.array(z.object({ id, entry_id: id, name: z.string().max(300), type: z.string(), size: z.number().int().positive().max(15 * 1024 * 1024), created: timestamp })),
  versions: z.array(z.object({ id, entry_id: id, data: z.string().max(500000).refine(v => { try { JSON.parse(v); return true; } catch { return false; } }), created: timestamp })),
  watches: z.array(watchSchema).optional(), directory: directorySchema.optional(), partTime: z.array(gigSchema).optional(),
  personal: personalBackupSchema.optional(),
}).refine(m => m.format !== "opportunity-desk-v2" || !!m.personal, "备份缺少个人数据");
export type BackupArchive = { manifest: z.infer<typeof archiveSchema>; files: Record<string, Uint8Array> };
type Fetcher = typeof fetch;

export async function exportArchive(request: Fetcher = fetch) {
  const fresh = await readJson<Record<string, unknown> & { files: { id: string; name: string }[] }>(await request("/api/desk?export=1", { cache: "no-store" }));
  const partTime = await readJson<{ items: unknown[] }>(await request("/api/part-time", { cache: "no-store" }));
  const personal = await readJson(await request("/api/backup", { cache: "no-store" }));
  const manifest = { ...fresh, format: "opportunity-desk-v2", exportedAt: new Date().toISOString(), personal, partTime: partTime.items };
  archiveSchema.parse(manifest);
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const f of fresh.files) {
    const r = await request("/api/desk?file=" + encodeURIComponent(f.id));
    if (!r.ok) throw Error("附件下载失败：" + f.name);
    files["files/" + f.id] = new Uint8Array(await r.arrayBuffer());
  }
  return zipSync(files, { level: 0 });
}

export function readArchive(bytes: Uint8Array): BackupArchive {
  if (bytes.length > 200 * 1024 * 1024) throw Error("备份超过 200 MB，请分批迁移");
  let total = 0;
  const files = unzipSync(bytes, { filter: file => { total += file.originalSize; if (total > 250 * 1024 * 1024) throw Error("备份解压后过大"); return true; } });
  if (!files["manifest.json"]) throw Error("缺少 manifest.json");
  const manifest = archiveSchema.parse(JSON.parse(strFromU8(files["manifest.json"])));
  for (const f of manifest.files) if (files["files/" + f.id]?.length !== f.size) throw Error("备份附件缺失或长度不符：" + f.name);
  return { manifest, files };
}

/** Same implementation is used by the UI and the end-to-end ZIP roundtrip tests. */
export async function restoreArchive(archive: BackupArchive, request: Fetcher = fetch) {
  const { manifest, files } = archive;
  const post = async (path: string, body: unknown) => readJson(await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const parents = new Set(manifest.entries.map(e => e.id));
  let orphaned = 0;
  for (const { deletedAt, ...entry } of manifest.entries) await post("/api/desk", { action: "restore", entry, deletedAt });
  for (const file of manifest.files) {
    // Old exports omitted deleted parents. These bytes cannot recreate the missing record.
    if (!parents.has(file.entry_id)) { orphaned++; continue; }
    const form = new FormData(); form.append("entryId", file.entry_id); form.append("restoreId", file.id); form.append("created", file.created);
    form.append("file", new File([files["files/" + file.id] as BlobPart], file.name, { type: file.type }));
    await readJson(await request("/api/desk", { method: "POST", body: form }));
  }
  for (const watch of manifest.watches || []) await post("/api/watches", { action: "restore", watch: { ...watch, revision: 0 } });
  if (manifest.directory) await post("/api/directory", { action: "restore", directory: manifest.directory });
  for (let i = 0; i < manifest.versions.length; i += 50) await post("/api/desk", { action: "restoreVersions", versions: manifest.versions.slice(i, i + 50) });
  for (const item of manifest.partTime || []) await post("/api/part-time?restore=1", { ...item, revision: 0 });
  if (manifest.personal) await post("/api/backup", manifest.personal);
  return { orphaned };
}
