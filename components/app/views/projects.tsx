"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, Clock3, Flag, FolderKanban, Pencil, Plus, Search, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Entry, type ProgressLog, closed, dayDiff, today } from "@/lib/model";
import { heatmapDays } from "@/lib/journey";
import { matchesAiFilter } from "@/lib/ai-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDesk } from "../store";
import { EmptyState, PageHeader, Pill, Segmented, StatusBadge, formatDay, relativeDay } from "../ui";
import ProgressDialog, { newProgress, type ProgressDraft } from "../progress-dialog";

const levels = ["bg-muted", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"];
export const isTrack = (e: Entry) => e.kind === "project" || e.kind === "competition";
export const lastActivity = (e: Entry) => e.progress.reduce((max, p) => p.date > max ? p.date : max, "");

export function KindIcon({ kind, className }: { kind: Entry["kind"]; className?: string }) {
  return kind === "project"
    ? <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-600/15 ring-inset dark:bg-blue-400/10 dark:text-blue-300", className)}><FolderKanban className="size-4" /></span>
    : <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-600/15 ring-inset dark:bg-amber-400/10 dark:text-amber-300", className)}><Trophy className="size-4" /></span>;
}

export default function ProjectsView() {
  const { data, newEntry, aiFilter, applyAiFilter } = useDesk();
  const params = useSearchParams();
  const urlQuery = params.get("q") || "";
  const [linkedQuery, setLinkedQuery] = useState(urlQuery);
  const thisYear = Number(today().slice(0, 4));
  const [kind, setKind] = useState<"all" | "project" | "competition">("all");
  const [query, setQuery] = useState(urlQuery), [year, setYear] = useState(thisYear), [onlyActive, setOnlyActive] = useState(true), [progress, setProgress] = useState<ProgressDraft | null>(null);
  if (urlQuery !== linkedQuery) { setLinkedQuery(urlQuery); setQuery(urlQuery); }
  const all = data.entries.filter(isTrack);
  const aiActive = aiFilter && (aiFilter.kind === "competition" || aiFilter.kind === "project");
  const items = all.filter(e => (kind === "all" || e.kind === kind) && (!aiActive || (aiFilter!.ids ? aiFilter!.ids.includes(e.id) : matchesAiFilter(e, aiFilter!))) && (!onlyActive || !closed(e))
    && [e.title, e.organization, e.notes].join(" ").toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  const years = [...new Set([thisYear, year, ...all.flatMap(e => e.progress.map(p => Number(p.date.slice(0, 4))))])].sort((a, b) => b - a);
  const add = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button><Plus />添加<ChevronDown className="opacity-70" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52">
      <DropdownMenuItem onSelect={() => newEntry("project")}><FolderKanban />个人项目<span className="ml-auto text-xs text-muted-foreground">作品、开源、研究</span></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => newEntry("competition")}><Trophy />比赛</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
  return <>
    <PageHeader title="项目与比赛" description="自己做的项目和参加的比赛。每次推进记一笔，达成里程碑时单独标记。" actions={add}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented value={kind} onChange={setKind} options={[
          { value: "all", label: "全部", count: all.length },
          { value: "project", label: <><FolderKanban />项目</>, count: all.filter(e => e.kind === "project").length },
          { value: "competition", label: <><Trophy />比赛</>, count: all.filter(e => e.kind === "competition").length },
        ]} />
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索项目或比赛" placeholder="搜索名称、团队、备注…" className="h-8 bg-card pl-8" value={query} onChange={e => setQuery(e.target.value)} /></div>
        <Select value={String(year)} onValueChange={v => setYear(Number(v))}><SelectTrigger size="sm" aria-label="热力图年份" className="bg-card"><SelectValue /></SelectTrigger><SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>)}</SelectContent></Select>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground"><Switch checked={onlyActive} onCheckedChange={setOnlyActive} />只看进行中</label>
        {aiActive && <Pill tone="blue">AI 筛选：{aiFilter!.label}<button className="ml-1 underline" onClick={() => applyAiFilter(null)}>清除</button></Pill>}
      </div>
    </PageHeader>
    {items.length ? <div className="flex flex-col gap-4">{items.map(entry => <TrackCard key={entry.id} entry={entry} year={year} onLog={(date, log, milestone) => setProgress(newProgress(entry, date, log, milestone))} />)}</div>
      : <EmptyState icon={<FolderKanban />} title={all.length ? "没有符合条件的记录" : "还没有项目或比赛"} description={all.length ? "试试关闭「只看进行中」，或换个关键词。" : "个人项目、开源作品、研究课题、比赛赛道都可以各建一条，之后随时记录推进和里程碑。"}
        action={!all.length && <div className="flex gap-2"><Button size="sm" onClick={() => newEntry("project")}><FolderKanban />添加项目</Button><Button size="sm" variant="outline" onClick={() => newEntry("competition")}><Trophy />添加比赛</Button></div>} />}
    <ProgressDialog draft={progress} onChange={setProgress} />
  </>;
}

function TrackCard({ entry, year, onLog }: { entry: Entry; year: number; onLog: (date?: string, log?: ProgressLog, milestone?: boolean) => void }) {
  const { openEntry } = useDesk();
  const [day, setDay] = useState("");
  const logs = entry.progress.filter(p => p.date.startsWith(String(year))), counts = new Map<string, number>(), milestoneDays = new Set(logs.filter(p => p.milestone).map(p => p.date));
  logs.forEach(p => counts.set(p.date, (counts.get(p.date) || 0) + 1));
  const minutes = logs.reduce((sum, p) => sum + p.minutes, 0), days = heatmapDays(year);
  const milestones = entry.progress.filter(p => p.milestone).toSorted((a, b) => b.date.localeCompare(a.date));
  const visible = entry.progress.filter(p => !day || p.date === day).toSorted((a, b) => b.date.localeCompare(a.date)).slice(0, day ? 30 : 4);
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => days.slice(w * 7, w * 7 + 7));
  const last = lastActivity(entry), project = entry.kind === "project";
  return <article className="flex flex-col rounded-xl border bg-card">
    <div className="flex items-start gap-3 p-4 pb-3">
      <KindIcon kind={entry.kind} />
      <button className="min-w-0 flex-1 text-left" onClick={() => openEntry(entry.id)}><h2 className="truncate text-[15px] font-semibold hover:text-primary">{entry.title}</h2>
        <p className="truncate text-xs text-muted-foreground">{entry.organization || (project ? "个人项目" : "比赛")}{entry.nextAction ? " · 下一步：" + entry.nextAction : ""}</p></button>
      <StatusBadge status={entry.status} />
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" />{entry.deadline ? <>{project ? "目标" : "截止"} {formatDay(entry.deadline, false)} <b className={cn("font-medium", dayDiff(entry.deadline) < 0 ? "text-muted-foreground" : dayDiff(entry.deadline) <= 7 ? "text-red-600 dark:text-red-400" : "text-foreground")}>{dayDiff(entry.deadline) < 0 ? "已过" : dayDiff(entry.deadline) === 0 ? "就是今天" : `还有 ${dayDiff(entry.deadline)} 天`}</b></> : project ? "没有设定目标日期" : "未设置截止"}</span>
      <span>{last ? <>上次推进 <b className="font-medium text-foreground">{relativeDay(last)}</b></> : "还没有进度"}</span>
      <span><b className="tabular font-medium text-foreground">{counts.size}</b> 天活跃</span>
      {milestones.length > 0 && <span className="inline-flex items-center gap-1"><Flag className="size-3 fill-amber-500 text-amber-500" /><b className="tabular font-medium text-foreground">{milestones.length}</b> 个里程碑</span>}
      {minutes > 0 && <span><b className="tabular font-medium text-foreground">{Math.round(minutes / 6) / 10}</b> 小时</span>}
    </div>
    {milestones.length > 0 && <div className="mx-4 mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
      {milestones.slice(0, 4).map(m => <button key={m.id} onClick={() => setDay(m.date)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-900 ring-1 ring-amber-600/20 ring-inset hover:ring-amber-600/40 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
        <Flag className="size-3 fill-amber-500 text-amber-500" /><span className="max-w-[16rem] truncate">{m.text.split("\n")[0]}</span><span className="tabular text-amber-700/70 dark:text-amber-300/70">{m.date.slice(5)}</span></button>)}
      {milestones.length > 4 && <span className="shrink-0 text-xs text-muted-foreground">另有 {milestones.length - 4} 个</span>}
    </div>}
    <div className="mt-3 grid border-t xl:grid-cols-[auto_minmax(0,1fr)]">
      <div className="min-w-0 border-b px-4 pt-3 xl:border-r xl:border-b-0">
        <div className="overflow-x-auto pb-1 scrollbar-thin" ref={el => { if (el) el.scrollLeft = el.scrollWidth; }}>
          <div className="flex w-max gap-[3px]" role="group" aria-label={`${entry.title} ${year} 年进度热力图`}>
            {weeks.map((week, w) => <div key={w} className="flex flex-col gap-[3px]">{week.map(d => { const count = counts.get(d.date) || 0, milestone = milestoneDays.has(d.date); return <button key={d.date} disabled={!d.inYear || d.future}
              title={`${d.date} · ${count} 条进度${milestone ? " · 里程碑" : ""}`} aria-label={`${d.date} ${count} 条进度${milestone ? "，含里程碑" : ""}`} onClick={() => setDay(c => c === d.date ? "" : d.date)}
              className={cn("size-[10px] rounded-[2px] transition-transform hover:scale-125 disabled:pointer-events-none", !d.inYear ? "invisible" : d.future ? "bg-muted/40" : milestone ? "bg-amber-500" : levels[Math.min(4, count)], day === d.date && "ring-2 ring-foreground ring-offset-1 ring-offset-card")} />; })}</div>)}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 py-2.5 text-[11px] text-muted-foreground"><span>{day ? formatDay(day) : `${year} 年 · 点击格子查看当天`}</span>
          <span className="flex items-center gap-1">少{levels.map(l => <i key={l} className={cn("size-2 rounded-[2px]", l)} />)}多<i className="ml-2 size-2 rounded-[2px] bg-amber-500" />里程碑</span></div>
      </div>
      <div className="min-w-0 px-4 py-3">
        <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium text-muted-foreground">{day ? "当天记录" : "最近记录"}</h3>{day && <button className="text-xs text-primary hover:underline" onClick={() => setDay("")}>返回最近</button>}</div>
        {visible.length ? <ul className="flex flex-col gap-2.5">{visible.map(log => <li key={log.id} className="group text-sm">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="tabular font-medium text-foreground">{log.date.slice(5)}</span>
            {log.milestone && <Pill tone="amber"><Flag className="size-3 fill-current" />里程碑</Pill>}{log.track && <Pill>{log.track}</Pill>}{log.minutes > 0 && <span className="inline-flex items-center gap-1"><Clock3 className="size-3" />{log.minutes} 分钟</span>}
            <button aria-label="编辑这条记录" className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => onLog(log.date, log)}><Pencil className="size-3" /></button></div>
          <p className={cn("mt-0.5 line-clamp-2 leading-relaxed", log.milestone && "font-medium")}>{log.text}</p>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">{day ? "这一天没有记录。" : "还没有记录，写下今天完成的一件事。"}</p>}
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
      <Button variant="ghost" size="sm" onClick={() => openEntry(entry.id)}>查看详情</Button>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => onLog(day || today(), undefined, true)}><Flag />记录里程碑</Button>
        <Button size="sm" onClick={() => onLog(day || today())}><Plus />{day ? "补记这一天" : "记录进度"}</Button>
      </div>
    </div>
  </article>;
}
