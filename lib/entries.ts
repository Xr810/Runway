import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, tx, type Db } from "./postgres";
import { defaultJobDeadline, defaultNextAction, normalizeLegacyNextAction, entryObject, entrySchema, type Entry } from "./model";

export class EntryError extends Error { constructor(public status: number, message: string) { super(message); } }
type Row = { data: Entry; revision: number; updated: string };
const parse = (row: Row) => {
  const entry=entrySchema.parse({ ...row.data, revision: row.revision });
  if(entry.kind==="job"){
    const oldNext=entry.nextAction,normalized=normalizeLegacyNextAction(entry.status,oldNext);
    if(normalized){entry.nextAction=normalized;if(!entry.deadline)entry.deadline=defaultJobDeadline({...entry,nextAction:oldNext});}
  }
  return entry;
};

/** Live (not deleted) records, newest first. */
export async function listEntries(db: Db = pool): Promise<Entry[]> {
  const rows = await db.query<Row>("SELECT data, revision, updated FROM entries WHERE deleted_at IS NULL ORDER BY updated DESC, id");
  return rows.rows.map(parse);
}
/** List view: full records minus the JD text, which can be up to 300 KB each. */
export async function listSummaries() {
  return (await listEntries()).map(entry => ({ ...entry, jd: "", jdChars: entry.jd.length }));
}
export async function getEntry(id: string, db: Db = pool): Promise<Entry | null> {
  const row = (await db.query<Row>("SELECT data, revision, updated FROM entries WHERE id=$1 AND deleted_at IS NULL", [id])).rows[0];
  return row ? parse(row) : null;
}
/** One history version by its own ID, body included, for agent detail reads (#17). */
export async function getVersion(id: string) {
  const row = (await pool.query<{ id: string; entry_id: string; data: unknown; created: string }>("SELECT id, entry_id, data, created FROM versions WHERE id=$1", [id])).rows[0];
  return row ? { ...row, data: JSON.stringify(row.data) } : null;
}
export async function listDeleted() {
  const rows = await pool.query<Row & { deleted_at: string }>("SELECT data, revision, updated, deleted_at FROM entries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200");
  return rows.rows.map(row => ({ ...parse(row), deletedAt: row.deleted_at }));
}

const historyFields = (e: Entry) => ({ jd: e.jd, jdStatus: e.jdStatus, jdSavedAt: e.jdSavedAt, summary: e.summary, url: e.url });

async function write(client: PoolClient, next: Entry, previous: Entry | null, now: string) {
  if (next.jdStatus === "missing" && (next.jd || next.summary)) next.jdStatus = "partial";
  const textChanged = !previous || previous.jd !== next.jd || previous.jdStatus !== next.jdStatus;
  // Summary and original-link edits are content too; snapshot them so the previous
  // text is not silently lost (#8).
  const contentChanged = textChanged || (previous !== null && (previous.summary !== next.summary || previous.url !== next.url));
  next.jdSavedAt = next.jd && textChanged ? now : previous?.jdSavedAt ?? next.jdSavedAt;
  next.revision = (previous?.revision ?? 0) + 1;
  if (!previous) {
    const inserted = await client.query("INSERT INTO entries(id,data,revision,updated) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [next.id, JSON.stringify(next), next.revision, now]);
    if (inserted.rowCount !== 1) throw new EntryError(409, "记录已存在，请重新加载");
    return next;
  }
  if (contentChanged) await client.query("INSERT INTO versions(id,entry_id,data,created) VALUES($1,$2,$3,$4)", [randomUUID(), next.id, JSON.stringify(historyFields(previous)), now]);
  const updated = await client.query("UPDATE entries SET data=$1, revision=$2, updated=$3 WHERE id=$4 AND revision=$5 AND deleted_at IS NULL", [JSON.stringify(next), next.revision, now, next.id, previous.revision]);
  if (updated.rowCount !== 1) throw new EntryError(409, "保存冲突，请重新加载");
  return next;
}

/** Full save with an optimistic revision check. `restore` never overwrites an existing record. */
export async function saveEntry(input: unknown, mode: "save" | "restore" = "save") {
  const parsed = entrySchema.safeParse(input); if (!parsed.success) throw new EntryError(400, parsed.error.issues[0].message);
  const entry = parsed.data;
  if (mode === "save" && !entry.revision && entry.kind === "job") {
    const originalNext=entry.nextAction;
    const legacyNext=normalizeLegacyNextAction(entry.status,originalNext);
    if (legacyNext) entry.nextAction=legacyNext;
    if (!entry.deadline) entry.deadline = defaultJobDeadline({...entry,nextAction:legacyNext?originalNext:entry.nextAction});
    if (!entry.nextAction) entry.nextAction = defaultNextAction(entry.status);
  }
  return tx(async client => {
    const row = (await client.query<Row & { deleted_at: string | null }>("SELECT data, revision, updated, deleted_at FROM entries WHERE id=$1 FOR UPDATE", [entry.id])).rows[0];
    if (mode === "restore" && row) return { entry: parse(row), skipped: true };
    if (row?.deleted_at) throw new EntryError(409, "记录已删除，请先从回收站恢复");
    const previous = row ? parse(row) : null;
    if ((previous?.revision ?? 0) !== entry.revision) throw new EntryError(409, "记录已更新，请重新打开后再修改");
    return { entry: await write(client, { ...entry }, mode === "restore" ? null : previous, new Date().toISOString()), skipped: false };
  }, { serializable: true });
}

const patchable = new Set(Object.keys(entryObject.shape).filter(k => !["id", "kind", "revision", "jdSavedAt"].includes(k)));
/** Changes a few fields without sending the whole record back (status, progress logs…). */
export async function patchEntry(id: string, revision: number, patch: Record<string, unknown>) {
  const unknown = Object.keys(patch).filter(k => !patchable.has(k));
  if (unknown.length) throw new EntryError(400, "不能修改字段：" + unknown.join("、"));
  return tx(async client => {
    const row = (await client.query<Row>("SELECT data, revision, updated FROM entries WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id])).rows[0];
    if (!row) throw new EntryError(404, "记录不存在");
    const previous = parse(row);
    if (previous.revision !== revision) throw new EntryError(409, "记录已更新，请重新加载");
    const normalized={...previous,...patch};
    if (normalized.kind === "job" && patch.status !== undefined && patch.nextAction === undefined) normalized.nextAction=defaultNextAction(String(patch.status));
    const originalNext=normalized.nextAction,legacyNext=normalizeLegacyNextAction(normalized.status,originalNext);
    if (legacyNext) { normalized.nextAction=legacyNext; if (!normalized.deadline) normalized.deadline=defaultJobDeadline({...normalized,nextAction:originalNext}); }
    const next = entrySchema.safeParse(normalized);
    if (!next.success) throw new EntryError(400, next.error.issues[0].message);
    return write(client, next.data, previous, new Date().toISOString());
  }, { serializable: true });
}

export async function deleteEntry(id: string, revision: number) {
  const result = await pool.query("UPDATE entries SET deleted_at=now() WHERE id=$1 AND revision=$2 AND deleted_at IS NULL", [id, revision]);
  if (result.rowCount !== 1) throw new EntryError(409, "记录已更新或已删除，请重新加载");
}
export async function undeleteEntry(id: string) {
  const result = await pool.query("UPDATE entries SET deleted_at=NULL, updated=now() WHERE id=$1 AND deleted_at IS NOT NULL", [id]);
  if (result.rowCount !== 1) throw new EntryError(404, "回收站里没有这条记录");
}

/** History versions. `data` is serialised as a JSON string, the format backups have always used. */
export async function listVersions(entryId?: string, withData = false) {
  const rows = await pool.query<{ id: string; entry_id: string; data: unknown; created: string }>(
    `SELECT id, entry_id, ${withData ? "data" : "NULL AS data"}, created FROM versions WHERE ($1::text IS NULL OR entry_id=$1) ORDER BY created DESC`, [entryId ?? null]);
  return rows.rows.map(v => withData ? { ...v, data: JSON.stringify(v.data) } : { id: v.id, entry_id: v.entry_id, created: v.created });
}
export async function restoreVersions(items: { id: string; entry_id: string; data: string; created: string }[]) {
  await tx(async client => {
    for (const v of items) await client.query("INSERT INTO versions(id,entry_id,data,created) SELECT $1,$2,$3::jsonb,$4 WHERE EXISTS(SELECT 1 FROM entries WHERE id=$2) ON CONFLICT DO NOTHING", [v.id, v.entry_id, v.data, v.created]);
  });
}
