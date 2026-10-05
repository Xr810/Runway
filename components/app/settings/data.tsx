"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, LogOut, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { strToU8, zipSync } from "fflate";
import { today, type Entry } from "@/lib/model";
import { type Reminder } from "@/lib/reminder-schema";
import { type EvaluationProfile } from "@/lib/enrichment-contract";
import { type Gig } from "@/lib/part-time-contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk, readJson, postJson, type DeskData } from "../store";
import { Panel, stamp } from "../ui";

function download(blob: Blob, name: string) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000); }

type Backup = DeskData & { deleted?: (Entry & { deletedAt: string })[]; reminders?: Reminder[]; profile?: EvaluationProfile; partTime?: Gig[] };

export default function DataSettings() {
  const { data, reload } = useDesk();
  const [busy, setBusy] = useState(false), [restore, setRestore] = useState<{ file: File } | null>(null);
  const input = useRef<HTMLInputElement>(null), router = useRouter();
  const [deleted, setDeleted] = useState<(Entry & { deletedAt: string })[] | null>(null);
  const loadDeleted = async () => { try { setDeleted((await readJson<{ entries: (Entry & { deletedAt: string })[] }>(await fetch("/api/desk?deleted=1", { cache: "no-store" }))).entries); } catch (e) { toast.error((e as Error).message); } };
  useEffect(() => { void Promise.resolve().then(loadDeleted); }, []);
  async function undelete(id: string) { try { await postJson("/api/desk", { action: "undelete", id }); toast.success("已恢复"); await Promise.all([loadDeleted(), reload()]); } catch (e) { toast.error((e as Error).message); } }
  async function logoutAll() {
    if (!window.confirm("退出所有设备上的登录，包括当前这台？")) return;
    try { await postJson("/api/auth", { action: "logout-all" }); router.replace("/login"); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  }
  async function exportBackup() {
    setBusy(true);
    try {
      const fresh = await readJson<Backup>(await fetch("/api/desk?export=1", { cache: "no-store" }));
      const partTime = await readJson<{ items: Gig[] }>(await fetch("/api/part-time", { cache: "no-store" }));
      const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify({ format: "opportunity-desk-v1", exportedAt: new Date().toISOString(), ...fresh, partTime: partTime.items }, null, 2)) };
      for (const f of fresh.files) { const r = await fetch("/api/desk?file=" + encodeURIComponent(f.id)); if (!r.ok) throw Error("附件下载失败：" + f.name); const bytes = new Uint8Array(await r.arrayBuffer()); if (bytes.length !== f.size) throw Error("附件内容不完整：" + f.name); files["files/" + f.id] = bytes; }
      // The CV file lives outside the entry attachments; keep it in the same archive (#9).
      if (fresh.profile?.cv) { const r = await fetch("/api/profile/cv"); if (!r.ok) throw Error("简历下载失败，未导出不完整备份"); const bytes = new Uint8Array(await r.arrayBuffer()); if (bytes.length !== fresh.profile.cv.size) throw Error("简历内容不完整"); files["cv/" + fresh.profile.cv.id] = bytes; }
      download(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), "runway-backup-" + today() + ".zip"); toast.success("完整备份已导出");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function readBackup(file: File) {
    try {
      if (file.size > 200 * 1024 * 1024) throw Error("备份超过 200 MB，请分批迁移");
      setRestore({ file });
    } catch (e) { toast.error("无法读取备份：" + (e as Error).message); }
  }
  async function runRestore() {
    if (!restore) return; setBusy(true);
    try {
      await readJson(await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/zip" }, body: restore.file }));
      setRestore(null); toast.success("恢复完成，已有记录保持不变");
    } catch (e) { toast.error("恢复失败：" + (e as Error).message); } finally { await Promise.all([reload(), loadDeleted()]); setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">数据与备份</h2><p className="mt-1 text-sm text-muted-foreground">这里可以随时导出一份完整备份到本地，请妥善保管。</p></div>
    <Panel title="导出" description={`${data.entries.length} 条记录 · ${data.files.length} 个附件 · ${data.versions.length} 个历史版本`}>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => void exportBackup()}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}导出完整备份</Button><span className="text-xs text-muted-foreground">ZIP 文件，包含记录、附件、历史版本、公司、关注名单、提醒、个人背景与简历，以及兼职与收入。</span></div>
    </Panel>
    <Panel title="从备份恢复" description="只新增不存在的记录。已有的同 ID 记录保持不变，不会被覆盖。">
      <input ref={input} type="file" accept=".zip" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void readBackup(f); e.target.value = ""; }} />
      <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload />选择备份文件</Button>
    </Panel>
    <Panel title="回收站" description="删除的岗位、项目和比赛会保留在这里，可以随时恢复。" bodyClassName="p-0">
      {deleted === null ? <p className="px-4 py-4 text-sm text-muted-foreground">正在读取…</p> : deleted.length ? <ul>{deleted.map(e => <li key={e.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
        <div className="min-w-0 flex-1"><p className="truncate text-sm">{e.title}</p><p className="text-xs text-muted-foreground">{e.organization || { job: "岗位", project: "项目", competition: "比赛" }[e.kind]} · {stamp(e.deletedAt)} 删除</p></div>
        <Button size="sm" variant="outline" onClick={() => void undelete(e.id)}><RotateCcw />恢复</Button></li>)}</ul> : <p className="px-4 py-4 text-sm text-muted-foreground">回收站是空的。</p>}
    </Panel>
    <Panel title="登录" description="怀疑密码或登录状态泄露时，可以让所有设备立即退出。">
      <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => void logoutAll()}><LogOut />退出所有设备</Button>
    </Panel>
    <Dialog open={!!restore} onOpenChange={open => { if (!open && !busy) setRestore(null); }}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>确认恢复</DialogTitle><DialogDescription>只会新增不存在的记录，已有记录保持不变。</DialogDescription></DialogHeader>
        <p className="text-sm">{restore?.file.name} · 服务器将验证完整性并一次性恢复，保留回收站状态和已有设置。</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRestore(null)}>取消</Button><Button disabled={busy} onClick={() => void runRestore()}>{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}开始恢复</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
