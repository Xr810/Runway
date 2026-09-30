"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { closed, dayDiff, today } from "@/lib/model";
import { timelineEvents } from "@/lib/journey";
import { Switch } from "@/components/ui/switch";
import { useDesk } from "../store";
import { CompanyMark, EmptyState, PageHeader, Pill, Segmented, relativeDay } from "../ui";
import { eventTone } from "./today";

const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" });

export default function ScheduleView() {
  const { data, openEntry, logoFor } = useDesk();
  const [kind, setKind] = useState<"all" | "job" | "project" | "competition">("all"), [past, setPast] = useState(false), [includeClosed, setIncludeClosed] = useState(false);
  const all = timelineEvents(data.entries.filter(e => (kind === "all" || e.kind === kind) && (includeClosed || !closed(e))));
  const pastCount = all.filter(e => e.date < today()).length;
  const events = past ? all : all.filter(e => e.date >= today());
  const months = [...new Set(events.map(e => e.date.slice(0, 7)))];
  return <>
    <PageHeader title="日程" description="截止、跟进、面试与笔试，按日期排列。时间均为新加坡时间。">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "全部" }, { value: "job", label: "岗位" }, { value: "project", label: "项目" }, { value: "competition", label: "比赛" }]} />
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground"><Switch checked={past} onCheckedChange={setPast} />显示过去的日程（{pastCount}）</label>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground"><Switch checked={includeClosed} onCheckedChange={setIncludeClosed} />包含已结束的记录</label>
      </div>
    </PageHeader>
    {months.length ? <div className="flex flex-col gap-8">{months.map(month => { const inMonth = events.filter(e => e.date.startsWith(month)), dates = [...new Set(inMonth.map(e => e.date))]; return <section key={month}>
      <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold">{Number(month.slice(5))}月<span className="text-xs font-normal text-muted-foreground">{month.slice(0, 4)} · {inMonth.length} 项</span></h2>
      <ol className="overflow-hidden rounded-xl border bg-card">{dates.map(date => { const diff = dayDiff(date); return <li key={date} className={cn("grid grid-cols-[64px_minmax(0,1fr)] border-b last:border-b-0 sm:grid-cols-[96px_minmax(0,1fr)]", diff < 0 && "opacity-60")}>
        <div className={cn("flex flex-col items-center justify-start border-r px-2 py-3 text-center", diff === 0 && "bg-accent/60")}>
          <span className={cn("tabular text-xl leading-none font-semibold", diff === 0 && "text-primary")}>{Number(date.slice(8))}</span>
          <span className="mt-1 text-[11px] text-muted-foreground">{weekday.format(new Date(date + "T00:00:00Z"))}</span>
          <span className={cn("mt-0.5 text-[11px]", diff === 0 ? "font-medium text-primary" : "text-muted-foreground")}>{relativeDay(date)}</span>
        </div>
        <ul className="flex flex-col py-1">{inMonth.filter(e => e.date === date).map(ev => <li key={ev.id}><button onClick={() => openEntry(ev.entry.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50">
          <CompanyMark name={ev.entry.organization || ev.entry.title} src={ev.entry.kind === "job" ? logoFor(ev.entry.organization) : undefined} size="sm" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{ev.entry.title}</p>
            <p className="truncate text-xs text-muted-foreground">{ev.time && <span className="tabular font-medium text-foreground">{ev.time} · </span>}{ev.detail || `${ev.entry.organization || (ev.entry.kind === "project" ? "个人项目" : ev.entry.kind === "job" ? "公司未填写" : "比赛")} · ${ev.entry.nextAction || ev.entry.status}`}</p></div>
          <Pill tone={eventTone[ev.type] ?? "gray"}>{ev.label}</Pill>
        </button></li>)}</ul>
      </li>; })}</ol>
    </section>; })}</div>
      : <EmptyState icon={<CalendarDays />} title={past ? "没有日程" : "没有即将到来的日程"} description="在岗位或比赛里填写截止、跟进日期，内置助手添加的面试和笔试也会出现在这里。" />}
  </>;
}
