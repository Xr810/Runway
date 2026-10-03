"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle, LogOut, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { entrySchema, today, type Entry } from "@/lib/model";
import { directorySchema } from "@/lib/journey";
import { watchSchema } from "@/lib/watches";
import { reminderSaveSchema, type Reminder } from "@/lib/reminder-schema";
import { profileSchema, type EvaluationProfile } from "@/lib/enrichment-contract";
import { gigSchema, type Gig } from "@/lib/part-time-contract";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk, readJson, postJson, type DeskData } from "../store";
import { Panel, stamp } from "../ui";

function download(blob: Blob, name: string) { const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 10000); }

type Backup = DeskData & { deleted?: (Entry & { deletedAt: string })[]; reminders?: Reminder[]; profile?: EvaluationProfile; partTime?: Gig[] };

export default function DataSettings() {
  const { data, reload } = useDesk();
  const [busy, setBusy] = useState(false), [restore, setRestore] = useState<{ manifest: Backup; files: Record<string, Uint8Array> } | null>(null);
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
      for (const f of fresh.files) { const r = await fetch("/api/desk?file=" + encodeURIComponent(f.id)); if (!r.ok) throw Error("附件下载失败：" + f.name); files["files/" + f.id] = new Uint8Array(await r.arrayBuffer()); }
      // The CV file lives outside the entry attachments; keep it in the same archive (#9).
      if (fresh.profile?.cv) { const r = await fetch("/api/profile/cv"); if (r.ok) files["cv/" + fresh.profile.cv.id] = new Uint8Array(await r.arrayBuffer()); }
      download(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), "runway-backup-" + today() + ".zip"); toast.success("完整备份已导出");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function readBackup(file: File) {
    try {
      if (file.size > 200 * 1024 * 1024) throw Error("备份超过 200 MB，请分批迁移");
      const contents = unzipSync(new Uint8Array(await file.arrayBuffer())); if (!contents["manifest.json"]) throw Error("缺少 manifest.json");
      const m = JSON.parse(strFromU8(contents["manifest.json"]));
      if (m.format !== "opportunity-desk-v1" || !Array.isArray(m.entries) || !Array.isArray(m.files) || !Array.isArray(m.versions)) throw Error("备份格式无效");
      m.entries.forEach((e: unknown) => entrySchema.parse(e)); if (m.directory) directorySchema.parse(m.directory);
      if (m.deleted !== undefined) { if (!Array.isArray(m.deleted)) throw Error("回收站格式无效"); m.deleted.forEach((e: unknown) => entrySchema.parse(e)); }
      if (m.reminders !== undefined) { if (!Array.isArray(m.reminders)) throw Error("提醒格式无效"); m.reminders.forEach((r: unknown) => reminderSaveSchema.parse(r)); }
      if (m.profile !== undefined) profileSchema.parse(m.profile);
      if (m.watches !== undefined) { if (!Array.isArray(m.watches)) throw Error("关注名单格式无效"); m.watches.forEach((w: unknown) => watchSchema.parse(w)); }
      if (m.partTime !== undefined) { if (!Array.isArray(m.partTime)) throw Error("兼职记录格式无效"); m.partTime.forEach((item: unknown) => gigSchema.parse(item)); }
      for (const f of m.files) if (typeof f.id !== "string" || typeof f.name !== "string" || !contents["files/" + f.id]) throw Error("备份附件缺失");
      setRestore({ manifest: m, files: contents });
    } catch (e) { toast.error("无法读取备份：" + (e as Error).message); }
  }
  async function runRestore() {
    if (!restore) return; setBusy(true);
    try {
      for (const entry of restore.manifest.entries) await postJson("/api/desk", { action: "restore", entry: { ...entry, revision: 0 } });
      // Recycle-bin records are imported live so their attachments can attach, then moved back (#2).
      const trashed: string[] = [];
      for (const entry of restore.manifest.deleted || []) { const r = await postJson<{ skipped: boolean }>("/api/desk", { action: "restore", entry: { ...entry, revision: 0 } }); if (!r.skipped) trashed.push(entry.id); }
      for (const file of restore.manifest.files) { const f = new FormData(); f.append("entryId", file.entry_id); f.append("restoreId", file.id); f.append("created", file.created); f.append("file", new File([restore.files["files/" + file.id] as BlobPart], file.name, { type: file.type }));
        const r = await fetch("/api/desk", { method: "POST", body: f }); if (!r.ok) throw Error("附件恢复失败：" + file.name); }
      for (const id of trashed) await postJson("/api/desk", { action: "delete", id, revision: 1 });
      for (const watch of restore.manifest.watches || []) await postJson("/api/watches", { action: "restore", watch: { ...watch, revision: 0 } });
      if (restore.manifest.directory) await postJson("/api/directory", { action: "restore", directory: restore.manifest.directory });
      const versions = restore.manifest.versions; for (let i = 0; i < versions.length; i += 50) await postJson("/api/desk", { action: "restoreVersions", versions: versions.slice(i, i + 50) });
      for (const item of restore.manifest.partTime || []) await postJson("/api/part-time?restore=1", { ...item, revision: 0 });
      // Reminders and personal background / CV (#9).
      for (const reminder of restore.manifest.reminders || []) await postJson("/api/reminders", { action: "save", reminder: { ...reminder, revision: 0 } });
      if (restore.manifest.reminderPreferences) await postJson("/api/settings/reminders", restore.manifest.reminderPreferences);
      const profile = restore.manifest.profile;
      if (profile) {
        const current = (await readJson<{ profile: EvaluationProfile }>(await fetch("/api/enrichment", { cache: "no-store" }))).profile;
        if (!current.background && !current.goals && !current.preferences && !current.cv) {
          if (profile.cv && restore.files["cv/" + profile.cv.id]) {
            const form = new FormData(); form.append("file", new File([restore.files["cv/" + profile.cv.id] as BlobPart], profile.cv.name, { type: profile.cv.mime }));
            const r = await fetch("/api/profile/cv", { method: "POST", body: form }); if (!r.ok) throw Error("简历恢复失败：" + profile.cv.name);
          }
          const fresh = (await readJson<{ profile: EvaluationProfile }>(await fetch("/api/enrichment", { cache: "no-store" }))).profile;
          await postJson("/api/enrichment", { action: "profile", profile: { ...fresh, background: profile.background, goals: profile.goals, preferences: profile.preferences, targets: profile.targets, evaluationPreset: profile.evaluationPreset, evaluationWeights: profile.evaluationWeights } });
        }
      }
      setRestore(null); toast.success("恢复完成，已有记录保持不变");
    } catch (e) { toast.error("部分内容没有恢复：" + (e as Error).message); } finally { await reload(); setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">数据与备份</h2><p className="mt-1 text-sm text-muted-foreground">服务器每晚自动备份数据库。这里可以随时导出一份完整备份到本地。</p></div>
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
        <p className="text-sm">{restore?.manifest.entries.length} 条记录 · {restore?.manifest.deleted?.length || 0} 条回收站记录 · {restore?.manifest.files.length} 个附件 · {restore?.manifest.watches?.length || 0} 个关注 · {restore?.manifest.reminders?.length || 0} 个提醒 · {restore?.manifest.partTime?.length || 0} 项兼职与收入</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRestore(null)}>取消</Button><Button disabled={busy} onClick={() => void runRestore()}>{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}开始恢复</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
