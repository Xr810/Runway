"use client";
import { useState } from "react";
import { Flag, LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type Entry, type ProgressLog, progressSchema, today } from "@/lib/model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDesk } from "./store";

export type ProgressDraft = ProgressLog & { entryId: string };
export const newProgress = (entry: Entry, date = today(), log?: ProgressLog, milestone = false): ProgressDraft =>
  ({ entryId: entry.id, ...(log || { id: crypto.randomUUID(), date, text: "", minutes: 0, track: "", milestone }) });

export default function ProgressDialog({ draft, onChange }: { draft: ProgressDraft | null; onChange: (draft: ProgressDraft | null) => void }) {
  const { data, patchEntry } = useDesk();
  const [busy, setBusy] = useState(false);
  const entry = data.entries.find(e => e.id === draft?.entryId);
  const editing = !!entry?.progress.some(p => p.id === draft?.id);
  const milestone = !!draft?.milestone, project = entry?.kind === "project";
  async function save() {
    if (!draft || !entry) return;
    const result = progressSchema.safeParse(draft); if (!result.success) { toast.error(result.error.issues[0].message); return; }
    setBusy(true);
    try {
      await patchEntry(entry, { progress: [...entry.progress.filter(p => p.id !== draft.id), result.data].sort((a, b) => a.date.localeCompare(b.date)) });
      onChange(null); toast.success(editing ? "已更新" : milestone ? "里程碑已记录" : "进度已记录");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!draft || !entry || !window.confirm("删除这条记录？")) return;
    setBusy(true);
    try { await patchEntry(entry, { progress: entry.progress.filter(p => p.id !== draft.id) }); onChange(null); toast.success("已删除"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open={!!draft} onOpenChange={open => { if (!open && !busy) onChange(null); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>{editing ? "编辑记录" : milestone ? "记录里程碑" : "记录进度"}</DialogTitle><DialogDescription>{entry?.title} · 一天可以记录多次，也可以补记以前的日期。</DialogDescription></DialogHeader>
      {draft && <form id="progress-form" className="grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label className={cn("flex items-center gap-3 rounded-lg border px-3 py-2.5 sm:col-span-2", milestone && "border-amber-500/40 bg-amber-50 dark:bg-amber-400/10")}>
          <Flag className={cn("size-4", milestone ? "fill-amber-500 text-amber-500" : "text-muted-foreground")} />
          <span className="flex-1"><span className="block text-sm font-medium">标记为里程碑</span><span className="block text-xs text-muted-foreground">{project ? "上线、发布、完成一个阶段…" : "提交、晋级、拿到名次…"} 会在热力图和时间线上单独标出</span></span>
          <Switch checked={milestone} onCheckedChange={v => onChange({ ...draft, milestone: v })} aria-label="标记为里程碑" />
        </label>
        <div className="grid gap-1.5"><Label htmlFor="p-date">日期</Label><Input id="p-date" type="date" required max={today()} value={draft.date} onChange={e => onChange({ ...draft, date: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label htmlFor="p-min">用时（分钟，可选）</Label><Input id="p-min" type="number" min={0} max={1440} value={draft.minutes || ""} onChange={e => onChange({ ...draft, minutes: Number(e.target.value) })} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="p-track">标签（可选）</Label><Input id="p-track" maxLength={120} placeholder={project ? "例如：前端、数据、写作" : "例如：研究、回测、提交"} value={draft.track} onChange={e => onChange({ ...draft, track: e.target.value })} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="p-text">{milestone ? "达成了什么" : "这次推进了什么"}</Label>
          <Textarea id="p-text" required maxLength={2000} rows={5} placeholder={milestone ? "第一行写里程碑名称，例如「v1.0 上线」，下面可以补充细节" : "做了什么、结果如何、下一步准备尝试什么"} value={draft.text} onChange={e => onChange({ ...draft, text: e.target.value })} /></div>
      </form>}
      <DialogFooter className="sm:justify-between">
        {editing ? <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void remove()}>删除</Button> : <span />}
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => onChange(null)}>取消</Button><Button type="submit" form="progress-form" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : milestone ? <Flag /> : <Plus />}保存</Button></div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
