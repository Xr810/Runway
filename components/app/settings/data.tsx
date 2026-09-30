"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, LogOut, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { today, type Entry } from "@/lib/model";
import { exportArchive, readArchive, restoreArchive, type BackupArchive } from "@/lib/backup-archive";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk, readJson, postJson } from "../store";
import { Panel, stamp } from "../ui";

function download(blob: Blob, name: string) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000); }

export default function DataSettings() {
  const { data, reload, reloadReminders } = useDesk();
  const [busy, setBusy] = useState(false), [restore, setRestore] = useState<BackupArchive | null>(null);
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
      const zip = await exportArchive();
      download(new Blob([zip as BlobPart], { type: "application/zip" }), "runway-backup-" + today() + ".zip"); toast.success("业务数据备份已导出");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function readBackup(file: File) {
    try {
      if (file.size > 200 * 1024 * 1024) throw Error("备份超过 200 MB，请分批迁移");
      setRestore(readArchive(new Uint8Array(await file.arrayBuffer())));
    } catch (e) { toast.error("无法读取备份：" + (e as Error).message); }
  }
  async function runRestore() {
    if (!restore) return; setBusy(true);
    try {
      const { orphaned } = await restoreArchive(restore);
      setRestore(null); toast.success("恢复完成，已有记录保持不变");
      if (orphaned) toast.warning(`旧备份缺少父记录，已跳过 ${orphaned} 个孤立附件；其余内容已恢复。`);
    } catch (e) { toast.error("部分内容没有恢复：" + (e as Error).message); } finally { await Promise.all([reload(), reloadReminders(), loadDeleted()]); setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">数据与备份</h2><p className="mt-1 text-sm text-muted-foreground">可以随时导出业务数据备份到本地。</p></div>
    <Panel title="导出" description={`${data.entries.length} 条记录 · ${data.files.length} 个附件 · ${data.versions.length} 个历史版本`}>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy} onClick={() => void exportBackup()}>{busy ? <LoaderCircle className="animate-spin" /> : <Download />}导出业务数据备份</Button><span className="text-xs text-muted-foreground">ZIP 文件，包含记录（含回收站）、附件、原文历史、公司、关注名单、兼职与收入、提醒及完成历史、个人背景和简历原文件。不含 AI 对话与评估历史、图标缓存、密钥和运行配置。</span></div>
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
        <p className="text-sm">{restore?.manifest.entries.length} 条记录 · {restore?.manifest.files.length} 个附件 · {restore?.manifest.watches?.length || 0} 家关注公司 · {restore?.manifest.partTime?.length || 0} 项兼职与收入</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRestore(null)}>取消</Button><Button disabled={busy} onClick={() => void runRestore()}>{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}开始恢复</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
