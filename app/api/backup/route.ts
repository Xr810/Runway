import { getUser } from "@/lib/auth";
import { validOrigin } from "@/lib/session";
import { maxBackupBytes, readBackup, restoreBackup } from "@/lib/backup";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!await getUser()) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!validOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403 });
  if (!request.body || Number(request.headers.get("content-length")) > maxBackupBytes) return Response.json({ error: "备份过大或为空" }, { status: 413 });
  try { const backup = await readBackup(request.body); await restoreBackup(backup); return Response.json({ ok: true }); }
  catch (error) { console.error("Backup restore failed", error); return Response.json({ error: "恢复失败，数据库未部分导入；请检查备份完整性或 ID 冲突" }, { status: 400 }); }
}
