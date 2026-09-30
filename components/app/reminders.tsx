"use client";
import { useState } from "react";
import { BellRing, Check, ExternalLink, LoaderCircle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { today } from "@/lib/model";
import { reminderSaveSchema, type Reminder, type Schedule } from "@/lib/reminder-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk, postJson } from "./store";
import { Panel, Pill, Segmented } from "./ui";

const nowClock = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
const weekdays = [[1, "一"], [2, "二"], [3, "三"], [4, "四"], [5, "五"], [6, "六"], [7, "日"]] as const;
const blank = (): Reminder => ({ id: crypto.randomUUID(), title: "", note: "", url: "", schedule: { type: "daily", time: "08:00", until: "" }, active: true, entryId: null, source: "user", revision: 0 });

export function TodayReminders() {
  const { reminders, reloadReminders, openEntry, askAssistant } = useDesk();
  const [managing, setManaging] = useState(false), [editing, setEditing] = useState<Reminder | null>(null), [busy, setBusy] = useState<string | null>(null);
  const clock = nowClock();
  async function toggle(id: string, done: boolean) {
    setBusy(id);
    try { await postJson("/api/reminders", { action: "done", id, day: today(), done }); await reloadReminders(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  const items = reminders.today, left = items.filter(r => !r.done).length;
  return <Panel title="今日提醒" description={items.length ? (left ? `还有 ${left} 项` : "今天的都完成了") : undefined}
    action={<div className="flex gap-1"><Button variant="ghost" size="xs" onClick={() => setEditing(blank())}><Plus />新增</Button><Button variant="ghost" size="xs" onClick={() => setManaging(true)}>管理</Button></div>} bodyClassName="p-0">
    {items.length ? <ul>{items.map(r => { const late = !r.done && r.schedule.time && r.schedule.time < clock; return <li key={r.id} className={cn("flex items-start gap-3 border-b px-4 py-2.5 last:border-b-0", r.done && "opacity-60")}>
      <Checkbox className="mt-0.5" checked={r.done} disabled={busy === r.id} aria-label={"完成 " + r.title} onCheckedChange={v => void toggle(r.id, v === true)} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", r.done && "line-through")}>{r.title}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {r.schedule.time ? <span className={cn("tabular", late && "font-medium text-red-600 dark:text-red-400")}>{r.schedule.time}{late ? " · 已过时间" : ""}</span> : <span>全天</span>}
          {r.url && <a className="inline-flex items-center gap-0.5 text-primary hover:underline" href={r.url} target="_blank" rel="noreferrer">打开<ExternalLink className="size-3" /></a>}
          {r.entryId && <button className="text-primary hover:underline" onClick={() => openEntry(r.entryId!)}>相关记录</button>}
        </p>
      </div>
      <button aria-label="编辑提醒" className="mt-0.5 text-muted-foreground hover:text-foreground" onClick={() => setEditing(r)}><Pencil className="size-3.5" /></button>
    </li>; })}</ul>
      : <div className="flex flex-col gap-2 px-4 py-5"><p className="flex items-center gap-2 text-sm text-muted-foreground"><BellRing className="size-4" />今天没有提醒。</p>
        <button className="self-start text-xs text-primary hover:underline" onClick={() => askAssistant("每天 8 点提醒我")}><Sparkles className="mr-1 inline size-3" />也可以直接告诉 AI 助手，比如“每天 8 点提醒我去 WorldQuant BRAIN 挖因子”</button></div>}
    <ReminderManager open={managing} onOpenChange={setManaging} onEdit={r => { setManaging(false); setEditing(r); }} />
    <ReminderEditor value={editing} onChange={setEditing} />
  </Panel>;
}

function ReminderManager({ open, onOpenChange, onEdit }: { open: boolean; onOpenChange: (open: boolean) => void; onEdit: (r: Reminder) => void }) {
  const { reminders, reloadReminders } = useDesk();
  const [busy, setBusy] = useState(false);
  async function save(r: Reminder) { setBusy(true); try { await postJson("/api/reminders", { action: "save", reminder: r }); await reloadReminders(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  async function remove(r: Reminder) { if (!window.confirm(`删除提醒「${r.title}」？`)) return; setBusy(true); try { await postJson("/api/reminders", { action: "delete", id: r.id }); await reloadReminders(); toast.success("已删除"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>全部提醒</DialogTitle><DialogDescription>暂停的提醒不会出现在「今日」页。</DialogDescription></DialogHeader>
      {reminders.reminders.length ? <ul className="overflow-hidden rounded-lg border">{reminders.reminders.map(r => { const { description, ...reminder } = r; return <li key={r.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
        <div className="min-w-0 flex-1"><p className={cn("truncate text-sm", !r.active && "text-muted-foreground")}>{r.title}</p><p className="text-xs text-muted-foreground">{description}{r.source === "ai" ? " · AI 创建" : ""}</p></div>
        <Switch checked={r.active} disabled={busy} aria-label={(r.active ? "暂停 " : "启用 ") + r.title} onCheckedChange={v => void save({ ...reminder, active: v })} />
        <Button size="icon-sm" variant="ghost" aria-label="编辑" onClick={() => onEdit(reminder)}><Pencil /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="删除" disabled={busy} onClick={() => void remove(reminder)}><Trash2 /></Button>
      </li>; })}</ul> : <p className="text-sm text-muted-foreground">还没有提醒。</p>}
    </DialogContent>
  </Dialog>;
}

export function ReminderEditor({ value, onChange }: { value: Reminder | null; onChange: (value: Reminder | null) => void }) {
  const { reloadReminders } = useDesk();
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Reminder>) => value && onChange({ ...value, ...patch });
  const setSchedule = (schedule: Schedule) => set({ schedule });
  const s = value?.schedule;
  const inferredMode = !s ? "daily" : s.type === "weekly" && [...s.days].sort().join() === "1,2,3,4,5" ? "weekdays" : s.type;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"once" | "daily" | "weekly" | "weekdays">(inferredMode);
  if ((value?.id ?? null) !== editingId) { setEditingId(value?.id ?? null); setMode(inferredMode); }
  async function save() {
    if (!value) return;
    const parsed = reminderSaveSchema.safeParse(value); if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setBusy(true);
    try { await postJson("/api/reminders", { action: "save", reminder: parsed.data }); await reloadReminders(); onChange(null); toast.success("提醒已保存"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open={!!value} onOpenChange={open => { if (!open && !busy) onChange(null); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{value?.revision ? "编辑提醒" : "新增提醒"}</DialogTitle><DialogDescription>到了日子会出现在「今日」页，完成后打勾。</DialogDescription></DialogHeader>
      {value && s && <form id="reminder-form" className="grid gap-4" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="grid gap-1.5"><Label htmlFor="r-title">提醒内容</Label><Input id="r-title" required autoFocus maxLength={300} placeholder="例如：去 WorldQuant BRAIN 挖因子" value={value.title} onChange={e => set({ title: e.target.value })} /></div>
        <div className="grid gap-2"><Label>重复</Label>
          <Segmented value={mode} onChange={m => { setMode(m); setSchedule(m === "once" ? { type: "once", date: today(), time: s.time } : m === "daily" ? { type: "daily", time: s.time, until: s.type === "once" ? "" : s.until } : m === "weekdays" ? { type: "weekly", days: [1, 2, 3, 4, 5], time: s.time, until: s.type === "once" ? "" : s.until } : { type: "weekly", days: s.type === "weekly" ? s.days : [1], time: s.time, until: s.type === "once" ? "" : s.until }); }}
            options={[{ value: "daily", label: "每天" }, { value: "weekdays", label: "工作日" }, { value: "weekly", label: "每周" }, { value: "once", label: "一次" }]} />
          {s.type === "weekly" && mode === "weekly" && <div className="flex gap-1">{weekdays.map(([d, label]) => <button type="button" key={d} onClick={() => setSchedule({ ...s, days: s.days.includes(d) ? s.days.filter(x => x !== d).length ? s.days.filter(x => x !== d) : s.days : [...s.days, d].sort() })}
            className={cn("size-8 rounded-md border text-xs", s.days.includes(d) ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>{label}</button>)}</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {s.type === "once" ? <div className="grid gap-1.5"><Label htmlFor="r-date">日期</Label><Input id="r-date" type="date" required value={s.date} onChange={e => setSchedule({ ...s, date: e.target.value })} /></div>
            : <div className="grid gap-1.5"><Label htmlFor="r-until">截止（可选）</Label><Input id="r-until" type="date" value={s.until} onChange={e => setSchedule({ ...s, until: e.target.value })} /></div>}
          <div className="grid gap-1.5"><Label htmlFor="r-time">时间（可选）</Label><Input id="r-time" type="time" value={s.time} onChange={e => setSchedule({ ...s, time: e.target.value })} /></div>
        </div>
        <div className="grid gap-1.5"><Label htmlFor="r-url">链接（可选）</Label><Input id="r-url" type="url" placeholder="https://platform.worldquantbrain.com" value={value.url} onChange={e => set({ url: e.target.value })} /></div>
        {value.source === "ai" && <p><Pill tone="violet">由 AI 助手创建</Pill></p>}
      </form>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onChange(null)}>取消</Button><Button type="submit" form="reminder-form" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}保存</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
