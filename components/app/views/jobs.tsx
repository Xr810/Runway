"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownUp,
  BriefcaseBusiness,
  Columns3,
  FileCheck2,
  FileText,
  List,
  ListFilter,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type Entry,
  closed,
  companyTypes,
  employmentTypes,
  schedules,
  score,
  workModes,
} from "@/lib/model";
import { matchesAiFilter } from "@/lib/ai-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesk } from "../store";
import { useAssistantPanel } from "../assistant-panel-context";
import {
  CompanyMark,
  EmptyState,
  PageHeader,
  ScoreValue,
  Segmented,
  StatusBadge,
  StatusDot,
  PriorityIcon,
  dueTone,
  keyDate,
  formatDay,
  jobStages,
  relativeDay,
  stageOf,
  type StageKey,
} from "../ui";
import { jdLabel } from "../entry-detail";
import { useEnrichment } from "../evaluation";

const attributes = [
  { key: "workMode", label: "工作模式", options: workModes },
  { key: "employmentType", label: "岗位类型", options: employmentTypes },
  { key: "schedule", label: "工作时间", options: schedules },
  { key: "companyType", label: "公司类型", options: companyTypes },
] as const;
type AttrKey = (typeof attributes)[number]["key"];
const sorts = {
  priority: "优先级",
  deadline: "截止日期",
  updated: "最近更新",
  score: "综合评分",
  company: "公司名称",
} as const;
type Sort = keyof typeof sorts;
const rank = (p: string) => (({ 高: 0, 中: 1, 低: 2 }) as Record<string, number>)[p] ?? 3;

// Per-browser layout preference; the server always renders the list.
const layoutListeners = new Set<() => void>();
function readLayout(): "list" | "board" {
  try {
    return localStorage.getItem("runway.jobs.layout") === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}
function subscribeLayout(listener: () => void) {
  layoutListeners.add(listener);
  return () => {
    layoutListeners.delete(listener);
  };
}
function writeLayout(value: "list" | "board") {
  try {
    localStorage.setItem("runway.jobs.layout", value);
  } catch {
    /* preference only */
  }
  layoutListeners.forEach((l) => l());
}

export default function JobsView() {
  const { data, loading, error, reload, openEntry, newEntry, logoFor } = useDesk();
  const { aiFilter, applyAiFilter } = useAssistantPanel();
  // The composite score must use the same custom weights as 洞察 (#6).
  const { feed } = useEnrichment();
  const weights = feed?.profile.evaluationWeights;
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || ""),
    [stage, setStage] = useState<StageKey | "all">("all");
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const stages = jobStages.filter((s) => showWithdrawn || s.key !== "withdrawn");
  const [filters, setFilters] = useState<Partial<Record<AttrKey, string>>>({}),
    [sort, setSort] = useState<Sort>("priority");
  const layout = useSyncExternalStore(subscribeLayout, readLayout, () => "list" as const),
    chooseLayout = writeLayout;
  // A ?q= link (e.g. from a browser agent) replaces the search text when it changes.
  const [linkedQuery, setLinkedQuery] = useState(params.get("q"));
  if (params.get("q") !== linkedQuery) {
    setLinkedQuery(params.get("q"));
    if (params.get("q") !== null) setQuery(params.get("q")!);
  }

  // This page only ever lists jobs; a cross-module AI filter must not pull in tracks (#22).
  const pool = useMemo(() => data.entries.filter((e) => e.kind === "job"), [data.entries]);
  const base = useMemo(
    () =>
      pool.filter(
        (e) =>
          (!aiFilter ||
            (aiFilter.ids ? aiFilter.ids.includes(e.id) : matchesAiFilter(e, aiFilter))) &&
          attributes.every((a) => !filters[a.key] || e[a.key] === filters[a.key]) &&
          (!query ||
            [e.title, e.organization, e.location, e.nextAction, e.summary, e.applicationChannel]
              .join(" ")
              .toLowerCase()
              .includes(query.toLowerCase())),
      ),
    [pool, aiFilter, filters, query],
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        jobStages.map((s) => [s.key, base.filter((e) => stageOf(e.status)?.key === s.key).length]),
      ) as Record<StageKey, number>,
    [base],
  );
  const visible = useMemo(() => {
    const order = new Map(data.entries.map((e, i) => [e.id, i]));
    return base
      .filter((e) => layout === "board" || stage === "all" || stageOf(e.status)?.key === stage)
      .sort((a, b) =>
        sort === "score"
          ? (score(b, weights) ?? -1) - (score(a, weights) ?? -1)
          : sort === "deadline"
            ? (keyDate(a, data.reminderPreferences)?.date || "9999").localeCompare(
                keyDate(b, data.reminderPreferences)?.date || "9999",
              )
            : sort === "company"
              ? a.organization.localeCompare(b.organization)
              : sort === "updated"
                ? order.get(a.id)! - order.get(b.id)!
                : rank(a.priority) - rank(b.priority) ||
                  (a.deadline || "9999").localeCompare(b.deadline || "9999"),
      );
  }, [base, stage, sort, layout, data.entries, data.reminderPreferences, weights]);
  const activeFilters = attributes.filter((a) => filters[a.key]).length;
  const clearAll = () => {
    setQuery("");
    setFilters({});
    setStage("all");
    applyAiFilter(null);
  };
  const tabs = [
    { key: "all" as const, label: "全部", count: base.length },
    ...stages.map((s) => ({ key: s.key, label: s.label, count: counts[s.key], tone: s.tone })),
  ];

  return (
    <>
      <PageHeader
        title="岗位"
        description={`${pool.length} 个 · ${pool.filter((e) => !closed(e)).length} 个进行中`}
        actions={
          <Button onClick={() => newEntry("job")}>
            <Plus />
            添加岗位
          </Button>
        }
      />

      {aiFilter && (
        <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-primary/20 bg-accent px-3 py-2 text-sm">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">AI 筛选：</span>
            {aiFilter.label}
            <span className="text-muted-foreground"> · {base.length} 条</span>
          </span>
          <Button size="xs" variant="ghost" onClick={() => applyAiFilter(null)}>
            <X />
            清除
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {layout === "list" && (
          <div
            className="-mx-1 flex gap-0.5 overflow-x-auto px-1 scrollbar-none"
            role="tablist"
            aria-label="按阶段筛选"
          >
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={stage === t.key}
                onClick={() => setStage(t.key)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  stage === t.key && "bg-muted font-medium text-foreground",
                )}
              >
                {"tone" in t && t.tone && <StatusDot tone={t.tone} />}
                {t.label}
                <span className="tabular text-xs text-faint">{t.count}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索岗位"
              placeholder="搜索公司、岗位、摘要…"
              className="h-7 pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                aria-label="清除搜索"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setQuery("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(activeFilters && "border-primary/40 text-primary")}
              >
                <ListFilter />
                筛选
                {activeFilters > 0 && (
                  <span className="tabular rounded bg-primary px-1 text-[11px] leading-4 text-primary-foreground">
                    {activeFilters}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">岗位属性</p>
                {activeFilters > 0 && (
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={() => setFilters({})}
                  >
                    全部清除
                  </button>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {attributes.map((a) => (
                  <label
                    key={a.key}
                    className="grid grid-cols-[64px_1fr] items-center gap-2 text-xs text-muted-foreground"
                  >
                    {a.label}
                    <Select
                      value={filters[a.key] || "__all"}
                      onValueChange={(v) =>
                        setFilters((f) => ({ ...f, [a.key]: v === "__all" ? "" : v }))
                      }
                    >
                      <SelectTrigger size="sm" className="w-full text-foreground">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all">不限</SelectItem>
                        {a.options.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowDownUp />
                {sorts[sort]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel className="text-xs text-muted-foreground">排序</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                {Object.entries(sorts).map(([k, v]) => (
                  <DropdownMenuRadioItem key={k} value={k}>
                    {v}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="显示选项">
                <SlidersHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuLabel className="text-xs text-muted-foreground">显示</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showWithdrawn}
                onCheckedChange={(checked) => {
                  if (!checked && stage === "withdrawn") setStage("all");
                  setShowWithdrawn(checked === true);
                }}
              >
                显示已放弃
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Segmented
            className="ml-auto"
            value={layout}
            onChange={chooseLayout}
            options={[
              {
                value: "list",
                label: (
                  <>
                    <List />
                    列表
                  </>
                ),
              },
              {
                value: "board",
                label: (
                  <>
                    <Columns3 />
                    看板
                  </>
                ),
              },
            ]}
          />
        </div>
        {activeFilters > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attributes
              .filter((a) => filters[a.key])
              .map((a) => (
                <button
                  key={a.key}
                  onClick={() => setFilters((f) => ({ ...f, [a.key]: "" }))}
                  className="inline-flex h-6 items-center gap-1 rounded-md border bg-card px-2 text-xs hover:border-primary/40"
                >
                  <span className="text-muted-foreground">{a.label}</span>
                  {filters[a.key]}
                  <X className="size-3 text-muted-foreground" />
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger"
          >
            {error}
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              重新加载
            </Button>
          </div>
        )}
        {loading ? (
          <div className="overflow-hidden rounded-lg border">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex h-11 items-center gap-3 border-b px-4 last:border-b-0">
                <div className="size-6 animate-pulse rounded-md bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : layout === "board" ? (
          <Board entries={visible} stages={stages} />
        ) : visible.length ? (
          <JobList
            entries={visible}
            groups={stage === "all" ? stages : null}
            onOpen={openEntry}
            logoFor={logoFor}
            weights={weights}
          />
        ) : (
          <EmptyState
            icon={<BriefcaseBusiness />}
            title={pool.length ? "没有符合条件的岗位" : "还没有岗位"}
            description={
              pool.length
                ? "换个关键词，或者清除筛选条件。"
                : "添加第一个岗位，或者把招聘截图交给 AI 助手整理。"
            }
            action={
              pool.length ? (
                <Button size="sm" variant="outline" onClick={clearAll}>
                  清除全部条件
                </Button>
              ) : (
                <Button size="sm" onClick={() => newEntry("job")}>
                  <Plus />
                  添加岗位
                </Button>
              )
            }
          />
        )}
      </div>
    </>
  );
}

function JdIcon({ entry }: { entry: Entry }) {
  const complete = entry.jdStatus === "complete";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex",
            complete
              ? "text-success"
              : entry.jdStatus === "partial"
                ? "text-warning"
                : "text-faint/60",
          )}
        >
          {complete ? <FileCheck2 className="size-3.5" /> : <FileText className="size-3.5" />}
        </span>
      </TooltipTrigger>
      <TooltipContent>原文：{jdLabel(entry)}</TooltipContent>
    </Tooltip>
  );
}

function KeyDate({ entry, compact = false }: { entry: Entry; compact?: boolean }) {
  const { data } = useDesk();
  const k = keyDate(entry, data.reminderPreferences);
  if (!k) return <span className="text-faint">—</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">{k.kind}</span>
      <span className={cn("tabular text-sm font-medium", dueTone(k.date))}>
        {compact ? k.date.slice(5).replace("-", "/") : formatDay(k.date, false)}
      </span>
      {!compact && <span className="text-xs text-faint">{relativeDay(k.date)}</span>}
    </span>
  );
}

function JobRow({
  entry: e,
  onOpen,
  logoFor,
  weights,
}: {
  entry: Entry;
  onOpen: (id: string) => void;
  logoFor: (name: string) => string;
  weights?: Parameters<typeof score>[1];
}) {
  return (
    <li>
      <button
        onClick={() => onOpen(e.id)}
        className={cn(
          "group grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,180px)_88px_196px_36px_20px] md:py-0 md:h-11",
          closed(e) && "opacity-60",
        )}
      >
        <PriorityIcon priority={e.priority} />
        <CompanyMark name={e.organization || e.title} src={logoFor(e.organization)} size="sm" />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{e.title}</span>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {e.organization || "公司未填写"}
            {e.location ? " · " + e.location : ""}
          </span>
        </span>
        <span className="hidden truncate text-xs text-muted-foreground md:block">
          {e.nextAction}
        </span>
        <span className="hidden md:block">
          <StatusBadge status={e.status} />
        </span>
        <span className="hidden md:block">
          <KeyDate entry={e} />
        </span>
        <ScoreValue entry={e} weights={weights} className="text-right text-sm" />
        <span className="hidden md:inline-flex">
          <JdIcon entry={e} />
        </span>
        {/* Narrow screens: second line with status and the key date. */}
        <span className="col-span-2 col-start-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
          <StatusBadge status={e.status} />
          <KeyDate entry={e} compact />
          <span className="truncate text-xs text-muted-foreground sm:hidden">{e.organization}</span>
        </span>
      </button>
    </li>
  );
}

function JobList({
  entries,
  groups,
  onOpen,
  logoFor,
  weights,
}: {
  entries: Entry[];
  groups: readonly (typeof jobStages)[number][] | null;
  onOpen: (id: string) => void;
  logoFor: (name: string) => string;
  weights?: Parameters<typeof score>[1];
}) {
  const row = (e: Entry) => (
    <JobRow key={e.id} entry={e} onOpen={onOpen} logoFor={logoFor} weights={weights} />
  );
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="hidden h-8 grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,180px)_88px_196px_36px_20px] items-center gap-x-3 border-b bg-muted/40 px-3 text-xs text-muted-foreground md:grid">
        <span className="w-4" />
        <span className="w-6" />
        <span>岗位</span>
        <span>下一步</span>
        <span>状态</span>
        <span>关键日期</span>
        <span className="text-right">评分</span>
        <span className="sr-only">原文</span>
      </div>
      {groups ? (
        groups.map((group) => {
          const items = entries.filter((e) => stageOf(e.status)?.key === group.key);
          if (!items.length) return null;
          return (
            <section key={group.key} aria-label={group.label}>
              <h2 className="flex h-8 items-center gap-2 border-b bg-muted/25 px-3 text-xs font-medium">
                <StatusDot tone={group.tone} />
                {group.label}
                <span className="tabular text-faint">{items.length}</span>
              </h2>
              <ul>{items.map(row)}</ul>
            </section>
          );
        })
      ) : (
        <ul>{entries.map(row)}</ul>
      )}
    </div>
  );
}

function Board({
  entries,
  stages,
}: {
  entries: Entry[];
  stages: readonly (typeof jobStages)[number][];
}) {
  const { openEntry, logoFor } = useDesk();
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 md:-mx-10 md:px-10">
      <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-2.5">
        {stages.map((stage) => {
          const items = entries.filter((e) => stageOf(e.status)?.key === stage.key);
          return (
            <section
              key={stage.key}
              className="flex min-h-[220px] flex-col rounded-lg bg-muted/50 p-1.5"
            >
              <header className="flex h-8 items-center gap-2 px-2">
                <StatusDot tone={stage.tone} />
                <h2 className="text-sm font-medium">{stage.label}</h2>
                <span className="tabular text-xs text-faint">{items.length}</span>
              </header>
              <div className="flex flex-col gap-1.5">
                {items.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => openEntry(e.id)}
                    className="flex flex-col gap-2 rounded-md border bg-card p-2.5 text-left shadow-panel transition-colors hover:border-foreground/15"
                  >
                    <div className="flex items-center gap-2">
                      <CompanyMark
                        name={e.organization || e.title}
                        src={logoFor(e.organization)}
                        size="xs"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {e.organization}
                      </span>
                      <PriorityIcon priority={e.priority} />
                    </div>
                    <p className="line-clamp-2 text-sm leading-snug font-medium">{e.title}</p>
                    <div className="flex items-center justify-between gap-2">
                      {stage.statuses.length > 1 ? (
                        <StatusBadge status={e.status} />
                      ) : (
                        <span className="truncate text-xs text-muted-foreground">{e.location}</span>
                      )}
                      <KeyDate entry={e} compact />
                    </div>
                  </button>
                ))}
                {!items.length && <p className="px-2 py-6 text-center text-xs text-faint">暂无</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
