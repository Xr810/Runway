"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  CalendarCheck2,
  CircleCheck,
  Flag,
  FolderKanban,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type Entry, closed, dayDiff, today } from "@/lib/model";
import { isApplied, timelineEvents } from "@/lib/journey";
import { Button } from "@/components/ui/button";
import { useDesk, readJson, postJson } from "../store";
import { useAssistantPanel } from "../assistant-panel-context";
import { TodayReminders } from "../reminders";
import {
  CompanyMark,
  EmptyState,
  HkTime,
  Panel,
  Stat,
  StatStrip,
  formatDay,
  kindCopy,
  relativeDay,
  textTones,
  type Tone,
} from "../ui";
import ProgressDialog, { newProgress, type ProgressDraft } from "../progress-dialog";
import { KindIcon, lastActivity } from "./projects";
import { recruitingReminders } from "@/lib/recruiting-reminders";
import { RECRUITING_TIME_ZONE } from "@/lib/appointments";

export const eventTone: Record<string, Tone> = {
  deadline: "red",
  followup: "blue",
  interview: "amber",
  assessment: "violet",
};
function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: RECRUITING_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  return h < 5 ? "夜深了" : h < 12 ? "早上好" : h < 18 ? "下午好" : "晚上好";
}
const inStages = (e: Entry, statuses: string[]) => statuses.includes(e.status);

export default function TodayView() {
  const { data, loading, openEntry, newEntry, logoFor } = useDesk();
  const [progress, setProgress] = useState<ProgressDraft | null>(null);
  const reminderPreferences = data.reminderPreferences;
  const open = data.entries.filter((e) => !closed(e)),
    jobs = open.filter((e) => e.kind === "job");
  const timeline = timelineEvents(open, reminderPreferences);
  const events = timeline.filter((e) => dayDiff(e.date) >= 0 && dayDiff(e.date) <= 14);
  const days = [...new Set(events.map((e) => e.date))];
  const dueSoon = open.filter(
    (e) =>
      e.deadline &&
      !(e.kind === "job" && isApplied(e)) &&
      dayDiff(e.deadline) >= 0 &&
      dayDiff(e.deadline) <= 7,
  ).length;
  const interviews = timeline.filter(
    (e) => ["interview", "assessment"].includes(e.type) && dayDiff(e.date) >= 0,
  ).length;
  const overdue = open
    .filter((e) => e.kind !== "job" && e.followUp && dayDiff(e.followUp) < 0)
    .map((e) => ({ entry: e, reason: `跟进日期已过 ${-dayDiff(e.followUp)} 天` }));
  const missed = jobs
    .filter((e) => e.status === "待投递" && e.deadline && dayDiff(e.deadline) < 0)
    .map((e) => ({ entry: e, reason: `截止已过 ${-dayDiff(e.deadline)} 天，还没投递` }));
  const waiting = recruitingReminders(jobs, reminderPreferences)
    .filter((reminder) => dayDiff(reminder.date) <= 0)
    .map((reminder) => ({
      entry: jobs.find((entry) => entry.id === reminder.entryId)!,
      reason: `${reminder.title} · 已到跟进日`,
    }));
  const assessments = timeline
    .filter((e) => e.type === "assessment" && dayDiff(e.date) <= 0)
    .map((e) => ({ entry: e.entry, reason: `${e.label} · ${e.date} · 待完成` }));
  const attention = [...missed, ...assessments, ...overdue, ...waiting].filter(
    (x, i, all) => x.entry && all.findIndex((y) => y.entry?.id === x.entry.id) === i,
  );
  const tracks = open
    .filter((e) => e.kind === "competition" || e.kind === "project")
    .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));

  const inInterviews = jobs.filter((e) => inStages(e, ["一面", "二面", "终面"])).length;

  return (
    <>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-5">
        <h1 className="text-xl font-semibold tracking-tight">{greeting()}</h1>
        <p
          className="text-sm text-muted-foreground"
          title="香港时间（UTC+8），「今日」以香港 00:00 换日"
        >
          {formatDay(today())} · 香港时间
        </p>
      </header>
      <DailyBrief />
      <StatStrip className="mt-4">
        <Stat
          label="进行中的申请"
          value={loading ? "–" : jobs.filter((e) => !inStages(e, ["待投递"])).length}
          hint={inInterviews ? `${inInterviews} 个在面试阶段` : "暂无面试阶段"}
        />
        <Stat
          label="待投递"
          value={loading ? "–" : jobs.filter((e) => e.status === "待投递").length}
        />
        <Stat
          label="7 天内截止"
          value={loading ? "–" : dueSoon}
          tone={dueSoon ? "warn" : "default"}
          hint="岗位与比赛"
        />
        <Stat label="待进行的面试 / 笔试" value={loading ? "–" : interviews} />
      </StatStrip>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="接下来两周"
          description={events.length ? `${events.length} 项安排` : undefined}
          action={
            <Button variant="ghost" size="xs" className="text-muted-foreground" asChild>
              <Link href="/schedule">
                完整日程
                <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          {days.length ? (
            <ol>
              {days.map((date) => {
                const isToday = dayDiff(date) === 0;
                return (
                  <li
                    key={date}
                    className="grid grid-cols-[76px_minmax(0,1fr)] border-b last:border-b-0 sm:grid-cols-[96px_minmax(0,1fr)]"
                  >
                    <div className="px-4 py-2.5">
                      <p
                        className={cn(
                          "tabular text-sm font-medium whitespace-nowrap",
                          isToday && "text-primary",
                        )}
                      >
                        {formatDay(date, false)}
                      </p>
                      <p className="text-xs text-faint">{relativeDay(date)}</p>
                    </div>
                    <ul className="flex flex-col py-1">
                      {events
                        .filter((e) => e.date === date)
                        .map((ev) => (
                          <li key={ev.id}>
                            <button
                              onClick={() => openEntry(ev.entry.id)}
                              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 rounded-md px-3 py-1.5 text-left hover:bg-muted/60 sm:grid-cols-[88px_minmax(0,1fr)_auto]"
                            >
                              <span
                                className={cn(
                                  "hidden truncate text-xs font-medium sm:block",
                                  textTones[eventTone[ev.type] ?? "gray"],
                                )}
                              >
                                {ev.label.replace(" / ", "/")}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  {ev.entry.title}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  <span
                                    className={cn(
                                      "sm:hidden",
                                      textTones[eventTone[ev.type] ?? "gray"],
                                    )}
                                  >
                                    {ev.label} ·{" "}
                                  </span>
                                  {ev.detail ||
                                    ev.entry.organization ||
                                    kindCopy[ev.entry.kind].orgEmpty}
                                </span>
                              </span>
                              {ev.time ? (
                                <HkTime time={ev.time} className="text-sm font-medium" />
                              ) : (
                                <span />
                              )}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              icon={<CalendarCheck2 />}
              title="未来两周没有安排"
              description="给岗位或比赛设置截止、跟进日期后，会显示在这里。"
              className="m-4 border-0"
            />
          )}
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel
            title="需要处理"
            description={attention.length ? `${attention.length} 项` : undefined}
            bodyClassName="p-0"
          >
            {attention.length ? (
              <ul>
                {attention.slice(0, 6).map(({ entry, reason }) => (
                  <li key={entry.id} className="border-b last:border-b-0">
                    <button
                      onClick={() => openEntry(entry.id)}
                      className="flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-muted/50"
                    >
                      <CompanyMark
                        name={entry.organization || entry.title}
                        src={entry.kind === "job" ? logoFor(entry.organization) : undefined}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{entry.title}</p>
                        <p className="truncate text-xs text-warning">{reason}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <CircleCheck className="size-4 text-success" />
                没有逾期事项
              </p>
            )}
            {attention.length > 6 && (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                另有 {attention.length - 6} 项
              </p>
            )}
          </Panel>

          <TodayReminders />

          <Panel
            title="项目与比赛"
            action={
              <Button variant="ghost" size="xs" className="text-muted-foreground" asChild>
                <Link href="/projects">
                  全部
                  <ArrowRight />
                </Link>
              </Button>
            }
            bodyClassName="p-0"
          >
            {tracks.length ? (
              <ul>
                {tracks.slice(0, 5).map((c) => {
                  const last = lastActivity(c),
                    milestone = c.progress
                      .filter((p) => p.milestone)
                      .map((p) => p.date + "\u0000" + p.text)
                      .sort()
                      .at(-1)
                      ?.split("\u0000");
                  return (
                    <li
                      key={c.id}
                      className="group flex items-center gap-2.5 border-b px-4 py-2 last:border-b-0"
                    >
                      <KindIcon kind={c.kind} className="size-6 rounded-md [&_svg]:size-3.5" />
                      <button className="min-w-0 flex-1 text-left" onClick={() => openEntry(c.id)}>
                        <p className="truncate text-sm font-medium">{c.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {milestone ? (
                            <span>
                              <Flag className="mr-1 inline size-3 -translate-y-px fill-warning text-warning" />
                              {milestone[1].split("\n")[0]} · {relativeDay(milestone[0])}
                            </span>
                          ) : last ? (
                            `上次推进 ${relativeDay(last)}`
                          ) : (
                            "还没有记录"
                          )}
                        </p>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`记录 ${c.title} 的进度`}
                        className="text-muted-foreground"
                        onClick={() => setProgress(newProgress(c))}
                      >
                        <Plus />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <p className="text-sm text-muted-foreground">还没有进行中的项目</p>
                <Button variant="outline" size="xs" onClick={() => newEntry("project")}>
                  <Plus />
                  添加
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>
      <ProgressDialog draft={progress} onChange={setProgress} />
    </>
  );
}

type Brief = {
  headline: string;
  items: { text: string; entryId: string | null; priority: "high" | "normal" }[];
  created: string;
};
/** AI plan for the day, plus a box to hand anything to the assistant. */
function DailyBrief() {
  const { openEntry, data, loading, newEntry } = useDesk();
  const { askAssistant } = useAssistantPanel();
  // An empty workspace has nothing to plan; show getting-started steps instead of a generic brief.
  const empty = !loading && !data.entries.length;
  const [brief, setBrief] = useState<Brief | null>(null),
    [configured, setConfigured] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ask, setAsk] = useState("");
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setBrief((await postJson<{ brief: Brief }>("/api/brief", {})).brief);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (loading || empty) return;
    let active = true;
    // First visit of the day generates the brief; later visits read the cached one.
    fetch("/api/brief", { cache: "no-store" })
      .then((r) => readJson<{ brief: Brief | null; configured: boolean }>(r))
      .then((d) => {
        if (!active) return;
        setConfigured(d.configured);
        setBrief(d.brief);
        if (!d.brief) {
          setBusy(true);
          postJson<{ brief: Brief }>("/api/brief", {})
            .then((r) => {
              if (active) setBrief(r.brief);
            })
            .catch((e) => {
              if (active) setError((e as Error).message);
            })
            .finally(() => {
              if (active) setBusy(false);
            });
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [data, loading, empty]);
  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-panel">
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {empty ? "开始使用" : configured ? "AI 今日建议" : "今日建议 · 根据记录生成"}
          </p>
          <p className="mt-0.5 text-sm font-semibold">
            {empty
              ? "添加第一条记录后，这里每天会给出建议"
              : busy && !brief
                ? "正在看今天的安排…"
                : brief?.headline || error || "还没有生成今天的建议"}
          </p>
        </div>
        {!empty && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label="重新生成"
            disabled={busy}
            onClick={() => void generate()}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          </Button>
        )}
      </div>
      {empty && (
        <div className="mt-3 flex flex-wrap gap-2 px-4 pl-11">
          <Button size="sm" onClick={() => newEntry("job")}>
            <Plus />
            添加岗位
          </Button>
          <Button size="sm" variant="outline" onClick={() => newEntry("project")}>
            <FolderKanban />
            添加项目
          </Button>
        </div>
      )}
      {!empty && brief && brief.items.length > 0 && (
        <ol className="mt-1.5 grid gap-x-6 px-4 pl-11 sm:grid-cols-2">
          {brief.items.map((item, i) => (
            <li key={i} className="flex min-w-0 items-start gap-2 py-1 text-sm">
              <span
                className={cn(
                  "mt-[7px] size-1.5 shrink-0 rounded-full",
                  item.priority === "high" ? "bg-danger" : "bg-faint",
                )}
              />
              {item.entryId ? (
                <button
                  className="min-w-0 text-left hover:text-primary"
                  onClick={() => openEntry(item.entryId!)}
                >
                  {item.text}
                </button>
              ) : (
                <span className="min-w-0">{item.text}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {error && brief && <p className="px-4 pt-1 pl-11 text-xs text-danger">{error}</p>}
      <form
        className="mt-3 flex items-center gap-2 border-t bg-muted/30 px-4 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ask.trim()) {
            askAssistant(ask.trim(), true);
            setAsk("");
          }
        }}
      >
        <input
          aria-label="告诉 AI 助手"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          placeholder="告诉 AI：贴岗位链接、设提醒…"
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
        />
        <Button
          type="submit"
          size="icon-xs"
          className="rounded-full"
          aria-label="发送"
          disabled={!ask.trim()}
        >
          <ArrowUp />
        </Button>
      </form>
    </section>
  );
}
