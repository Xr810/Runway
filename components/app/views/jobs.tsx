"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, BriefcaseBusiness, Columns3, FileCheck2, FileText, Flag, List, ListFilter, Plus, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Entry, closed, companyTypes, dayDiff, employmentTypes, regions, schedules, score, workModes } from "@/lib/model";
import { matchesAiFilter } from "@/lib/ai-contract";
import { isApplied } from "@/lib/journey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesk } from "../store";
import { CompanyMark, DueLabel, EmptyState, PageHeader, ScoreValue, Segmented, StatusBadge, jobStages, solidTones, stageOf, type Tone, type StageKey } from "../ui";
import { jdLabel } from "../entry-detail";

const attributes = [
  { key: "region", label: "地区", options: regions },
  { key: "workMode", label: "工作模式", options: workModes },
  { key: "employmentType", label: "岗位类型", options: employmentTypes },
  { key: "schedule", label: "工作时间", options: schedules },
  { key: "companyType", label: "公司类型", options: companyTypes },
] as const;
type AttrKey = (typeof attributes)[number]["key"];
const sorts = { priority: "优先级", deadline: "截止日期", updated: "最近更新", score: "综合评分", company: "公司名称" } as const;
type Sort = keyof typeof sorts;
const rank = (p: string) => ({ 高: 0, 中: 1, 低: 2 } as Record<string, number>)[p] ?? 3;

/** The date that matters next for this record: the nearest upcoming deadline or follow-up. */
/** Once a job is applied to, its application deadline no longer matters; only follow-ups do. */
export function keyDate(e: Entry) {
  const deadline = e.kind === "job" && isApplied(e) ? "" : e.deadline;
  const upcoming = [{ date: deadline, kind: "截止" }, { date: e.followUp, kind: "跟进" }].filter(d => d.date && dayDiff(d.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] ?? (deadline ? { date: deadline, kind: "截止" } : e.followUp ? { date: e.followUp, kind: "跟进" } : null);
}
// Per-browser layout preference; the server always renders the list.
const layoutListeners = new Set<() => void>();
function readLayout(): "list" | "board" { try { return localStorage.getItem("runway.jobs.layout") === "board" ? "board" : "list"; } catch { return "list"; } }
function subscribeLayout(listener: () => void) { layoutListeners.add(listener); return () => { layoutListeners.delete(listener); }; }
function writeLayout(value: "list" | "board") { try { localStorage.setItem("runway.jobs.layout", value); } catch { /* preference only */ } layoutListeners.forEach(l => l()); }

export default function JobsView() {
  const { data, loading, error, reload, openEntry, newEntry, logoFor, aiFilter, applyAiFilter } = useDesk();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || ""), [stage, setStage] = useState<StageKey | "all" | "active">("active");
  const [filters, setFilters] = useState<Partial<Record<AttrKey, string>>>({}), [sort, setSort] = useState<Sort>("priority");
  const layout = useSyncExternalStore(subscribeLayout, readLayout, () => "list" as const), chooseLayout = writeLayout;
  // A ?q= link (e.g. from a browser agent) replaces the search text when it changes.
  const [linkedQuery, setLinkedQuery] = useState(params.get("q"));
  if (params.get("q") !== linkedQuery) { setLinkedQuery(params.get("q")); if (params.get("q") !== null) setQuery(params.get("q")!); }

  const pool = useMemo(() => data.entries.filter(e => aiFilter?.kind === "all" ? true : e.kind === "job"), [data.entries, aiFilter]);
  const base = useMemo(() => pool.filter(e => (!aiFilter || (aiFilter.ids ? aiFilter.ids.includes(e.id) : matchesAiFilter(e, aiFilter)))
    && attributes.every(a => !filters[a.key] || e[a.key] === filters[a.key])
    && (!query || [e.title, e.organization, e.notes, e.location, e.nextAction, e.summary, e.applicationChannel].join(" ").toLowerCase().includes(query.toLowerCase()))), [pool, aiFilter, filters, query]);
  const counts = useMemo(() => Object.fromEntries(jobStages.map(s => [s.key, base.filter(e => stageOf(e.status)?.key === s.key).length])) as Record<StageKey, number>, [base]);
  const visible = useMemo(() => {
    const order = new Map(data.entries.map((e, i) => [e.id, i]));
    return base.filter(e => layout === "board" || stage === "all" || (stage === "active" ? !closed(e) : stageOf(e.status)?.key === stage)).sort((a, b) =>
      sort === "score" ? (score(b) ?? -1) - (score(a) ?? -1)
        : sort === "deadline" ? (keyDate(a)?.date || "9999").localeCompare(keyDate(b)?.date || "9999")
          : sort === "company" ? a.organization.localeCompare(b.organization)
            : sort === "updated" ? order.get(a.id)! - order.get(b.id)!
              : rank(a.priority) - rank(b.priority) || (a.deadline || "9999").localeCompare(b.deadline || "9999"));
  }, [base, stage, sort, layout, data.entries]);
  const activeFilters = attributes.filter(a => filters[a.key]).length;
  const activeCount = base.filter(e => !closed(e)).length;

  return <>
    <PageHeader title="岗位" description={`${pool.filter(e => e.kind === "job").length} 个岗位，${pool.filter(e => e.kind === "job" && !closed(e)).length} 个仍在进行`}
      actions={<Button onClick={() => newEntry("job")}><Plus />添加岗位</Button>} />

    {aiFilter && <div className="mb-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-accent/60 px-4 py-2.5 text-sm">
      <Sparkles className="size-4 text-primary" /><span className="min-w-0 flex-1 truncate"><span className="font-medium">AI 筛选：</span>{aiFilter.label}<span className="text-muted-foreground"> · {base.length} 条</span></span>
      <Button size="xs" variant="ghost" onClick={() => applyAiFilter(null)}><X />清除</Button>
    </div>}

    <div className="flex flex-col gap-3">
      {layout === "list" && <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none" role="tablist" aria-label="按阶段筛选">
        {([{ key: "active", label: "进行中", count: activeCount }, ...jobStages.map(s => ({ key: s.key, label: s.label, count: counts[s.key], tone: s.tone })), { key: "all", label: "全部", count: base.length }] as { key: StageKey | "all" | "active"; label: string; count: number; tone?: Tone }[]).map(s =>
          <button key={s.key} role="tab" aria-selected={stage === s.key} onClick={() => setStage(s.key)}
            className={cn("inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-transparent px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground", stage === s.key && "border-border bg-card text-foreground shadow-sm")}>
            {s.tone && <span className={cn("size-2 rounded-full", solidTones[s.tone])} />}{s.label}<span className="tabular text-xs text-muted-foreground">{s.count}</span>
          </button>)}
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="搜索岗位" placeholder="搜索公司、岗位、备注…" className="h-8 bg-card pl-8" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button aria-label="清除搜索" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery("")}><X className="size-3.5" /></button>}
        </div>
        <Popover>
          <PopoverTrigger asChild><Button variant="outline" size="sm" className={cn("bg-card", activeFilters && "border-primary/40 text-primary")}><ListFilter />筛选{activeFilters > 0 && <span className="tabular rounded bg-primary px-1 text-[11px] text-primary-foreground">{activeFilters}</span>}</Button></PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <div className="flex items-center justify-between"><p className="text-sm font-medium">岗位属性</p>{activeFilters > 0 && <button className="text-xs text-primary hover:underline" onClick={() => setFilters({})}>全部清除</button>}</div>
            <div className="mt-3 flex flex-col gap-3">{attributes.map(a => <label key={a.key} className="grid grid-cols-[72px_1fr] items-center gap-2 text-xs text-muted-foreground">{a.label}
              <Select value={filters[a.key] || "__all"} onValueChange={v => setFilters(f => ({ ...f, [a.key]: v === "__all" ? "" : v }))}>
                <SelectTrigger size="sm" className="w-full text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__all">不限</SelectItem>{a.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select></label>)}</div>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="bg-card"><ArrowDownUp />{sorts[sort]}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuLabel className="text-xs text-muted-foreground">排序</DropdownMenuLabel><DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={sort} onValueChange={v => setSort(v as Sort)}>{Object.entries(sorts).map(([k, v]) => <DropdownMenuRadioItem key={k} value={k}>{v}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Segmented className="ml-auto" value={layout} onChange={chooseLayout} options={[{ value: "list", label: <><List />列表</> }, { value: "board", label: <><Columns3 />看板</> }]} />
      </div>
      {activeFilters > 0 && <div className="flex flex-wrap gap-1.5">{attributes.filter(a => filters[a.key]).map(a => <button key={a.key} onClick={() => setFilters(f => ({ ...f, [a.key]: "" }))} className="inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-xs hover:border-primary/40">{a.label}：{filters[a.key]}<X className="size-3 text-muted-foreground" /></button>)}</div>}
    </div>

    <div className="mt-4">
      {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">{error}<Button size="sm" variant="outline" onClick={() => void reload()}>重新加载</Button></div>}
      {loading ? <div className="space-y-2">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
        : layout === "board" ? <Board entries={visible} />
          : visible.length ? <JobTable entries={visible} onOpen={openEntry} logoFor={logoFor} />
            : <EmptyState icon={<BriefcaseBusiness />} title={pool.length ? "没有符合条件的岗位" : "还没有岗位"} description={pool.length ? "换个关键词，或者清除筛选条件。" : "添加第一个岗位，或者把招聘截图交给 AI 助手整理。"}
              action={pool.length ? <Button size="sm" variant="outline" onClick={() => { setQuery(""); setFilters({}); setStage("all"); applyAiFilter(null); }}>清除全部条件</Button> : <Button size="sm" onClick={() => newEntry("job")}><Plus />添加岗位</Button>} />}
    </div>
  </>;
}

function JdIcon({ entry }: { entry: Entry }) {
  const complete = entry.jdStatus === "complete";
  return <Tooltip><TooltipTrigger asChild><span className={cn("inline-flex", complete ? "text-emerald-600 dark:text-emerald-400" : entry.jdStatus === "partial" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground/50")}>{complete ? <FileCheck2 className="size-4" /> : <FileText className="size-4" />}</span></TooltipTrigger><TooltipContent>原文：{jdLabel(entry)}</TooltipContent></Tooltip>;
}
function PriorityFlag({ priority }: { priority: string }) {
  if (!priority || priority === "低") return null;
  return <Tooltip><TooltipTrigger asChild><Flag className={cn("size-3.5 shrink-0", priority.includes("高") || priority.includes("P0") ? "fill-red-500 text-red-500" : "fill-amber-400 text-amber-500")} /></TooltipTrigger><TooltipContent>优先级 {priority}</TooltipContent></Tooltip>;
}

function JobTable({ entries, onOpen, logoFor }: { entries: Entry[]; onOpen: (id: string) => void; logoFor: (name: string) => string }) {
  return <>
    <div className="hidden overflow-hidden rounded-xl border bg-card md:block">
      <table className="w-full table-fixed text-sm">
        <thead><tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <th className="w-[38%] px-4 py-2.5 font-medium">岗位</th><th className="w-[12%] px-3 py-2.5 font-medium">状态</th><th className="px-3 py-2.5 font-medium">下一步</th>
          <th className="w-[13%] px-3 py-2.5 font-medium">关键日期</th><th className="w-[64px] px-3 py-2.5 text-right font-medium">评分</th><th className="w-[48px] px-3 py-2.5 font-medium"><span className="sr-only">原文</span></th>
        </tr></thead>
        <tbody>{entries.map(e => { const k = keyDate(e); return <tr key={e.id} onClick={() => onOpen(e.id)} className={cn("group cursor-pointer border-b last:border-b-0 hover:bg-muted/40", closed(e) && "text-muted-foreground")}>
          <td className="px-4 py-3"><div className="flex items-center gap-3">
            <CompanyMark name={e.organization || e.title} src={e.kind === "job" ? logoFor(e.organization) : undefined} />
            <div className="min-w-0"><button className="flex max-w-full items-center gap-1.5 text-left font-medium text-foreground group-hover:text-primary" onClick={ev => { ev.stopPropagation(); onOpen(e.id); }}><span className="truncate">{e.title}</span><PriorityFlag priority={e.priority} /></button>
              <p className="truncate text-xs text-muted-foreground">{e.organization || "公司未填写"}{e.location ? " · " + e.location : ""}{e.employmentType !== "待核实" ? " · " + e.employmentType.split(" ")[0] : ""}</p></div>
          </div></td>
          <td className="px-3 py-3"><StatusBadge status={e.status} /></td>
          <td className="px-3 py-3"><p className="line-clamp-2 text-[13px] text-muted-foreground">{e.nextAction || "—"}</p></td>
          <td className="px-3 py-3">{k ? <DueLabel date={k.date} kind={k.kind} /> : <span className="text-muted-foreground">—</span>}</td>
          <td className="px-3 py-3 text-right"><ScoreValue entry={e} /></td>
          <td className="px-3 py-3"><JdIcon entry={e} /></td>
        </tr>; })}</tbody>
      </table>
    </div>
    <ul className="flex flex-col gap-2 md:hidden">{entries.map(e => { const k = keyDate(e); return <li key={e.id}><button onClick={() => onOpen(e.id)} className="flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left">
      <CompanyMark name={e.organization || e.title} src={e.kind === "job" ? logoFor(e.organization) : undefined} />
      <div className="min-w-0 flex-1"><p className="flex items-center gap-1.5 text-sm font-medium"><span className="truncate">{e.title}</span><PriorityFlag priority={e.priority} /></p><p className="truncate text-xs text-muted-foreground">{e.organization}{e.location ? " · " + e.location : ""}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={e.status} />{k && <span className="text-xs text-muted-foreground">{k.kind} {k.date.slice(5)} · {dayDiff(k.date) >= 0 ? dayDiff(k.date) + " 天后" : "已过"}</span>}</div>
        {e.nextAction && <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{e.nextAction}</p>}</div>
      <ScoreValue entry={e} className="text-sm" />
    </button></li>; })}</ul>
  </>;
}

function Board({ entries }: { entries: Entry[] }) {
  const { openEntry, logoFor } = useDesk();
  return <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
    <div className="grid auto-cols-[minmax(232px,1fr)] grid-flow-col gap-3">
      {jobStages.map(stage => { const items = entries.filter(e => stageOf(e.status)?.key === stage.key); return <section key={stage.key} className="flex min-h-[200px] flex-col rounded-xl bg-muted/60 p-2">
        <header className="flex items-center gap-2 px-1.5 pt-1 pb-2.5"><span className={cn("size-2 rounded-full", solidTones[stage.tone])} /><h2 className="text-[13px] font-semibold">{stage.label}</h2><span className="tabular text-xs text-muted-foreground">{items.length}</span></header>
        <div className="flex flex-col gap-2">{items.map(e => { const k = keyDate(e); return <button key={e.id} onClick={() => openEntry(e.id)} className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-primary/40">
          <div className="flex items-center gap-2"><CompanyMark name={e.organization || e.title} src={logoFor(e.organization)} size="sm" /><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{e.organization}</span><PriorityFlag priority={e.priority} /></div>
          <p className="line-clamp-2 text-[13px] leading-snug font-medium">{e.title}</p>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            {stage.statuses.length > 1 ? <StatusBadge status={e.status} /> : <span className="truncate">{e.location || e.region}</span>}
            {k && <span className={cn("tabular shrink-0", dayDiff(k.date) >= 0 && dayDiff(k.date) <= 3 && "font-medium text-red-600 dark:text-red-400")}>{k.kind} {k.date.slice(5)}</span>}
          </div>
        </button>; })}
          {!items.length && <p className="px-2 py-4 text-center text-xs text-muted-foreground">暂无</p>}</div>
      </section>; })}
    </div>
  </div>;
}
