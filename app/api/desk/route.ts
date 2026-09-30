import { z } from "zod";
import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { pool } from "@/lib/postgres";
import { localFiles, FileTooLarge } from "@/lib/files";
import { EntryError, deleteEntry, getEntry, listDeleted, exportEntries, listSummaries, listVersions, patchEntry, restoreVersions, saveEntry, undeleteEntry } from "@/lib/entries";
import { allWatches } from "@/lib/watch-storage";
import { getDirectory } from "@/lib/directory-storage";
import { syncEnrichment } from "@/lib/enrichment";
export const dynamic = "force-dynamic";

const maxFile = 15 * 1024 * 1024;
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
async function authorize(request: Request, write = false) {
  if (!await getUser()) return json({ error: "请先登录" }, 401);
  if (write && !validOrigin(request)) return json({ error: "请求来源无效" }, 403);
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), entry: z.unknown() }),
  z.object({ action: z.literal("restore"), entry: z.unknown(), deletedAt: z.string().datetime({ offset: true }).nullable().optional() }),
  z.object({ action: z.literal("patch"), id, revision: z.number().int().min(1), patch: z.record(z.unknown()) }),
  z.object({ action: z.literal("delete"), id, revision: z.number().int().min(1) }),
  z.object({ action: z.literal("undelete"), id }),
  z.object({ action: z.literal("restoreVersions"), versions: z.array(z.object({ id, entry_id: id, data: z.string().max(500000).refine(v => { try { JSON.parse(v); return true; } catch { return false; } }, "历史版本内容无效"), created: z.string().refine(v => !Number.isNaN(Date.parse(v))) })).max(500) }),
]);

/**
 * GET              → list view: records without JD text, file and version metadata, watches, directory
 * GET ?entry=ID    → one full record with its version history
 * GET ?export=1    → everything, full text included (backup export)
 * GET ?deleted=1   → recycle bin
 * GET ?file=ID     → attachment download
 */
export async function GET(request: Request) {
  const denied = await authorize(request); if (denied) return denied;
  try {
    const params = new URL(request.url).searchParams, fileId = params.get("file"), entryId = params.get("entry");
    if (fileId) {
      const file = (await pool.query<{ name: string }>("SELECT name FROM files WHERE id=$1", [fileId])).rows[0]; if (!file) return json({ error: "附件不存在" }, 404);
      const obj = await localFiles.get(fileId); if (!obj) return json({ error: "附件内容缺失" }, 404);
      return new Response(obj.body, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(file.name), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (entryId) { const entry = await getEntry(entryId); return entry ? json({ entry, versions: await listVersions(entryId, true) }) : json({ error: "记录不存在或已删除" }, 404); }
    if (params.get("deleted")) return json({ entries: await listDeleted() });
    const full = params.get("export") === "1";
    const [entries, files, versions, watches, directory] = await Promise.all([full ? exportEntries() : listSummaries(), pool.query("SELECT * FROM files ORDER BY created DESC").then(r => r.rows), listVersions(undefined, full), allWatches(), getDirectory()]);
    return json({ entries, files, versions, watches, directory });
  } catch (e) { console.error(e); return json({ error: "读取失败，请稍后重试" }, 503); }
}

export async function POST(request: Request) {
  const denied = await authorize(request, true); if (denied) return denied;
  if (request.headers.get("content-type")?.includes("multipart/form-data")) return upload(request);
  const size = Number(request.headers.get("content-length") || 0);
  if (!size || size > 5 * 1024 * 1024) return json({ error: size ? "请求过大" : "请求内容为空" }, size ? 413 : 400);
  let body;
  try { body = actions.safeParse(await request.json()); } catch { return json({ error: "请求格式无效" }, 400); }
  if (!body.success) return json({ error: body.error.issues[0].message }, 400);
  try {
    const input = body.data;
    let result: unknown;
    if (input.action === "save" || input.action === "restore") result = await saveEntry(input.entry, input.action, input.action === "restore" ? input.deletedAt : null);
    else if (input.action === "patch") result = { entry: await patchEntry(input.id, input.revision, input.patch) };
    else if (input.action === "delete") { await deleteEntry(input.id, input.revision); result = { ok: true }; }
    else if (input.action === "undelete") { await undeleteEntry(input.id); result = { ok: true }; }
    else { await restoreVersions(input.versions); return json({ ok: true }); }
    await syncEnrichment();
    return json(result);
  } catch (e) {
    if (e instanceof EntryError) return json({ error: e.message }, e.status);
    console.error(e); return json({ error: "保存失败，输入内容已保留，请重试" }, 503);
  }
}

async function upload(request: Request) {
  // Reject oversized uploads before the body is read.
  const length = Number(request.headers.get("content-length") || 0);
  if (!length || length > maxFile + 64 * 1024) return json({ error: "文件需为 1 字节至 15 MB" }, 413);
  try {
    const form = await request.formData(), file = form.get("file"), entryId = String(form.get("entryId") || "");
    if (!(file instanceof File) || file.size > maxFile || file.size === 0) return json({ error: "文件需为 1 字节至 15 MB" }, 400);
    const restoreId = form.get("restoreId");
    if (restoreId && (typeof restoreId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(restoreId))) return json({ error: "附件 ID 无效" }, 400);
    const fileId = typeof restoreId === "string" ? restoreId : crypto.randomUUID();
    const existing = (await pool.query<{ entry_id: string }>("SELECT entry_id FROM files WHERE id=$1", [fileId])).rows[0];
    if (existing) return existing.entry_id === entryId ? json({ id: fileId }) : json({ error: "附件 ID 冲突" }, 409);
    if (!(await pool.query("SELECT 1 FROM entries WHERE id=$1 AND ($2::boolean OR deleted_at IS NULL)", [entryId, !!restoreId])).rowCount) return json({ error: "请先保存记录" }, 404);
    const createdInput = form.get("created"), created = typeof createdInput === "string" && !Number.isNaN(Date.parse(createdInput)) ? createdInput : new Date().toISOString();
    await localFiles.put(fileId, file.stream(), maxFile);
    try { await pool.query("INSERT INTO files (id,entry_id,name,type,size,created) VALUES ($1,$2,$3,$4,$5,$6)", [fileId, entryId, file.name.slice(0, 300), file.type, file.size, created]); }
    catch (e) { await localFiles.delete(fileId); throw e; }
    return json({ id: fileId });
  } catch (e) {
    if (e instanceof FileTooLarge) return json({ error: "文件需为 1 字节至 15 MB" }, 413);
    console.error(e); return json({ error: "附件保存失败，请重试" }, 503);
  }
}
