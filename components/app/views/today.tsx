"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlarmClock, ArrowRight, ArrowUp, Bell, CalendarCheck2, Flag, FolderKanban, Hourglass, LoaderCircle, Plus, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Entry, closed, dayDiff, today } from "@/lib/model";
import { isApplied, timelineEvents } from "@/lib/journey";
import { Button } from "@/components/ui/button";
import { useDesk, readJson, postJson } from "../store";
import { TodayReminders } from "../reminders";
import { CompanyMark, EmptyState, Panel, Pill, Stat, formatDay, kindCopy, relativeDay, stamp, type Tone } from "../ui";
import ProgressDialog, { newProgress, type ProgressDraft } from "../progress-dialog";
import { KindIcon, lastActivity } from "./projects";
import { recruitingReminders } from "@/lib/recruiting-reminders";

export const eventTone: Record<string, Tone> = { deadline: "red", followup: "blue", interview: "amber", assessment: "violet" };
function greeting() { const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "numeric", hour12: false }).format(new Date())); return h < 5 ? "夜深了" : h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好"; }
const inStages = (e: Entry, statuses: string[]) => statuses.includes(e.status);

export default function TodayView() {
  const { data, loading, openEntry, newEntry, logoFor, notifications, setNotificationsOpen } = useDesk();
  const [progress, setProgress] = useState<ProgressDraft | null>(null);
  const reminderPreferences = data.reminderPreferences;
  const open = data.entries.filter(e => !closed(e)), jobs = open.filter(e => e.kind === "job");
  const events = timelineEvents(open, reminderPreferences).filter(e => dayDiff(e.date) >= 0 && dayDiff(e.date) <= 14);
  const days = [...new Set(events.map(e => e.date))];
  const dueSoon = open.filter(e => e.deadline && !(e.kind === "job" && isApplied(e)) && dayDiff(e.deadline) >= 0 && dayDiff(e.deadline) <= 7).length;
  const interviews = jobs.flatMap(e => e.appointments.filter(a => a.status === "scheduled" && Date.parse(a.startsAt) >= Date.now())).length;
  const overdue = open.filter(e => e.followUp && dayDiff(e.followUp) < 0).map(e => ({ entry: e, reason: `跟进日期已过 ${-dayDiff(e.followUp)} 天` }));
  const missed = jobs.filter(e => e.status === "待投递" && e.deadline && dayDiff(e.deadline) < 0).map(e => ({ entry: e, reason: `截止已过 ${-dayDiff(e.deadline)} 天，还没投递` }));
  const waiting = recruitingReminders(jobs, reminderPreferences).filter(reminder => dayDiff(reminder.date) <= 0).map(reminder => ({ entry: jobs.find(entry => entry.id === reminder.entryId)!, reason: `${reminder.title} · 已到跟进日` }));
  const attention = [...missed, ...overdue, ...waiting].filter((x, i, all) => x.entry && all.findIndex(y => y.entry?.id === x.entry.id) === i);
  const tracks = open.filter(e => e.kind === "competition" || e.kind === "project").sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));

  return <>
    <header className="pb-6">
      <p className="text-sm text-muted-foreground">{formatDay(today())} · 新加坡时间</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{greeting()}</h1>
    </header>
    <DailyBrief />
    <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="进行中的申请" value={loading ? "–" : jobs.filter(e => !inStages(e, ["待投递"])).length} hint={`${jobs.filter(e => inStages(e, ["一面", "二面", "终面"])).length} 个在面试阶段`} />
      <Stat label="待投递" value={loading ? "–" : jobs.filter(e => e.status === "待投递").length} hint="还没提交的岗位" />
      <Stat label="7 天内截止" value={loading ? "–" : dueSoon} tone={dueSoon ? "warn" : "default"} hint="岗位与比赛" />
      <Stat label="待进行的面试 / 笔试" value={loading ? "–" : interviews} hint="已预约的日程" />
    </div>

    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="接下来两周" description="截止、跟进、面试与笔试" action={<Button variant="ghost" size="xs" asChild><Link href="/schedule">完整日程<ArrowRight /></Link></Button>} bodyClassName="p-0">
        {days.length ? <ol>{days.map(date => <li key={date} className="grid grid-cols-[84px_minmax(0,1fr)] border-b last:border-b-0 sm:grid-cols-[112px_minmax(0,1fr)]">
          <div className={cn("border-r px-4 py-3", dayDiff(date) === 0 && "bg-accent/50")}>
            <p className={cn("tabular text-sm font-semibold whitespace-nowrap", dayDiff(date) === 0 && "text-primary")}>{formatDay(date, false)}</p>
            <p className="text-xs text-muted-foreground">{relativeDay(date)}</p>
          </div>
          <ul className="flex flex-col py-1.5">{events.filter(e => e.date === date).map(ev => <li key={ev.id}><button onClick={() => openEntry(ev.entry.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50">
            <Pill tone={eventTone[ev.type] ?? "gray"} className="hidden w-[68px] justify-center sm:inline-flex">{ev.label.replace(" / ", "/")}</Pill>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{ev.entry.title}</p><p className="truncate text-xs text-muted-foreground"><span className="sm:hidden">{ev.label} · </span>{ev.time && <span className="tabular font-medium text-foreground">{ev.time} · </span>}{ev.detail || ev.entry.organization || kindCopy[ev.entry.kind].orgEmpty}</p></div>
          </button></li>)}</ul>
        </li>)}</ol>
          : <EmptyState icon={<CalendarCheck2 />} title="未来两周没有安排" description="给岗位或比赛设置截止、跟进日期后，会显示在这里。" className="m-4 border-0" />}
      </Panel>

      <div className="flex flex-col gap-6">
        <TodayReminders />
        <Panel title="需要处理" description="逾期跟进、错过的截止、久未回复" bodyClassName="p-0">
          {attention.length ? <ul>{attention.slice(0, 6).map(({ entry, reason }) => <li key={entry.id} className="border-b last:border-b-0"><button onClick={() => openEntry(entry.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
            <CompanyMark name={entry.organization || entry.title} src={entry.kind === "job" ? logoFor(entry.organization) : undefined} size="sm" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.title}</p><p className="flex items-center gap-1 truncate text-xs text-amber-700 dark:text-amber-400"><AlarmClock className="size-3 shrink-0" />{reason}</p></div>
          </button></li>)}</ul>
            : <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Hourglass className="size-4" />没有逾期事项。</p>}
          {attention.length > 6 && <p className="border-t px-4 py-2 text-xs text-muted-foreground">另有 {attention.length - 6} 项</p>}
        </Panel>

        <Panel title="最近更新" action={<Button variant="ghost" size="xs" onClick={() => setNotificationsOpen(true)}>全部<ArrowRight /></Button>} bodyClassName="p-0">
          {notifications.items.length ? <ul>{notifications.items.slice(0, 4).map(n => <li key={n.id} className="border-b last:border-b-0"><button onClick={() => n.entryId ? openEntry(n.entryId) : setNotificationsOpen(true)} className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} />
            <div className="min-w-0 flex-1"><p className="truncate text-sm">{n.organization ? n.organization + " · " : ""}{n.title}</p><p className="truncate text-xs text-muted-foreground">{n.summary}</p></div>
            <time className="shrink-0 text-[11px] text-muted-foreground">{stamp(n.created).split(" ")[0]}</time>
          </button></li>)}</ul>
            : <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground"><Bell className="size-4" />暂无更新。</p>}
        </Panel>

        <Panel title="项目与比赛" action={<Button variant="ghost" size="xs" asChild><Link href="/projects">全部<ArrowRight /></Link></Button>} bodyClassName="p-0">
          {tracks.length ? <ul>{tracks.slice(0, 5).map(c => { const last = lastActivity(c), milestone = c.progress.filter(p => p.milestone).map(p => p.date + "\u0000" + p.text).sort().at(-1)?.split("\u0000"); return <li key={c.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
            <KindIcon kind={c.kind} className="size-7 rounded-md [&_svg]:size-3.5" />
            <button className="min-w-0 flex-1 text-left" onClick={() => openEntry(c.id)}><p className="truncate text-sm font-medium">{c.title}</p>
              <p className="truncate text-xs text-muted-foreground">{milestone ? <span className="text-amber-700 dark:text-amber-400"><Flag className="mr-1 inline size-3 -translate-y-px fill-current" />{milestone[1].split("\n")[0]} · {relativeDay(milestone[0])}</span> : last ? `上次推进 ${relativeDay(last)}` : "还没有记录"}</p></button>
            <Button variant="outline" size="xs" onClick={() => setProgress(newProgress(c))}><Plus />记录</Button>
          </li>; })}</ul>
            : <div className="px-4 py-5"><p className="text-sm text-muted-foreground">还没有进行中的项目或比赛。</p><Button variant="outline" size="sm" className="mt-3" onClick={() => newEntry("project")}><FolderKanban />添加项目</Button></div>}
        </Panel>
      </div>
    </div>
    <ProgressDialog draft={progress} onChange={setProgress} />
  </>;
}

type Brief = { headline: string; items: { text: string; entryId: string | null; priority: "high" | "normal" }[]; created: string };
/** AI plan for the day, plus a box to hand anything to the assistant. */
function DailyBrief() {
  const { openEntry, askAssistant, data } = useDesk();
  const [brief, setBrief] = useState<Brief | null>(null), [configured, setConfigured] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [ask, setAsk] = useState("");
  async function generate() {
    setBusy(true); setError("");
    try { setBrief((await postJson<{ brief: Brief }>("/api/brief", {})).brief); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    // First visit of the day generates the brief; later visits read the cached one.
    fetch("/api/brief", { cache: "no-store" }).then(r => readJson<{ brief: Brief | null; configured: boolean }>(r)).then(d => {
      if (!active) return; setConfigured(d.configured); setBrief(d.brief);
      if (!d.brief) { setBusy(true); postJson<{ brief: Brief }>("/api/brief", {}).then(r => { if (active) setBrief(r.brief); }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setBusy(false); }); }
    }).catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [data]);
  return <section className="overflow-hidden rounded-xl border border-primary/15 bg-gradient-to-br from-accent/70 via-card to-card shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
    <div className="flex items-start gap-3 px-4 pt-4">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-accent-foreground/80">{configured ? "AI 今日建议" : "今日建议 · 根据记录生成"}</p>
        <p className="mt-0.5 text-[15px] font-semibold">{busy && !brief ? "正在看今天的安排…" : brief?.headline || error || "还没有生成今天的建议"}</p>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="重新生成" disabled={busy} onClick={() => void generate()}>{busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}</Button>
    </div>
    {brief && brief.items.length > 0 && <ol className="mt-2 flex flex-col px-4">{brief.items.map((item, i) => <li key={i} className="flex items-start gap-2.5 py-1.5 text-sm">
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.priority === "high" ? "bg-red-500" : "bg-primary/50")} />
      {item.entryId ? <button className="text-left hover:text-primary hover:underline" onClick={() => openEntry(item.entryId!)}>{item.text}</button> : <span>{item.text}</span>}
    </li>)}</ol>}
    {error && brief && <p className="px-4 pt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    <form className="m-3 mt-3 flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 focus-within:border-primary/50" onSubmit={e => { e.preventDefault(); if (ask.trim()) { askAssistant(ask.trim(), true); setAsk(""); } }}>
      <input aria-label="告诉 AI 助手" className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="告诉 AI：设提醒、贴岗位链接、调整求职方向…" value={ask} onChange={e => setAsk(e.target.value)} />
      <Button type="submit" size="icon-xs" className="rounded-full" aria-label="发送" disabled={!ask.trim()}><ArrowUp /></Button>
    </form>
  </section>;
}
