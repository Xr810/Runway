"use client";
import { useState } from "react";
import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { type Entry, dayDiff, internshipValue, score } from "@/lib/model";
import { useDesk } from "../store";
import { EvaluationQueue } from "../evaluation";
import { CompanyMark, EmptyState, PageHeader, Panel, Segmented, Stat, jobStages, solidTones } from "../ui";

const reached = (e: Entry, statuses: string[]) => statuses.includes(e.status);
const afterApply = ["已投递", "笔试", "一面", "二面", "终面", "Offer", "未通过"];
const afterScreen = ["笔试", "一面", "二面", "终面", "Offer"];
const pct = (a: number, b: number) => b ? Math.round(a / b * 100) + "%" : "—";

export default function InsightsView() {
  const { data } = useDesk();
  const [tab, setTab] = useState<"overview" | "evaluation">("overview");
  const jobs = data.entries.filter(e => e.kind === "job");
  return <>
    <PageHeader title="洞察" description="申请进展、等待时长与岗位评估。">
      <Segmented value={tab} onChange={setTab} options={[{ value: "overview", label: "概览" }, { value: "evaluation", label: "岗位评估" }]} />
    </PageHeader>
    {tab === "overview" ? <Overview jobs={jobs} /> : <EvaluationQueue entries={jobs} />}
  </>;
}

function Overview({ jobs }: { jobs: Entry[] }) {
  const { openEntry, logoFor, evaluationWeights } = useDesk();
  if (!jobs.length) return <EmptyState title="还没有岗位数据" description="添加岗位后，这里会显示申请漏斗和转化情况。" />;
  const applied = jobs.filter(e => e.applied || reached(e, afterApply)), screened = jobs.filter(e => reached(e, afterScreen)), offers = jobs.filter(e => e.status === "Offer");
  const stages = jobStages.map(s => ({ ...s, count: jobs.filter(e => (s.statuses as readonly string[]).includes(e.status)).length }));
  const max = Math.max(...stages.map(s => s.count), 1);
  const waiting = jobs.filter(e => e.status === "已投递" && e.applied).map(e => ({ e, days: Math.max(0, -dayDiff(e.applied)) })).sort((a, b) => b.days - a.days);
  const maxWait = Math.max(28, ...waiting.map(w => w.days));
  const evalScore = (e: Entry) => score(e, evaluationWeights);
  const scored = jobs.filter(e => evalScore(e) !== null).sort((a, b) => evalScore(b)! - evalScore(a)!).slice(0, 8);
  const scatter = jobs.flatMap(e=>{const y=internshipValue(e);return e.fit!==null&&y!==null?[{x:e.fit,y,name:e.organization+" · "+e.title,id:e.id}]:[]});
  return <div className="flex flex-col gap-6">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="岗位总数" value={jobs.length} hint={`${jobs.filter(e => e.status === "待投递").length} 个还没投递`} />
      <Stat label="已投递" value={applied.length} hint={`占全部 ${pct(applied.length, jobs.length)}`} />
      <Stat label="进入笔试 / 面试" value={screened.length} hint={`投递后转化 ${pct(screened.length, applied.length)}`} />
      <Stat label="Offer" value={offers.length} tone={offers.length ? "good" : "default"} hint={`面试后转化 ${pct(offers.length, screened.length)}`} />
    </div>
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Panel title="各阶段岗位数">
        <ul className="flex flex-col gap-3">{stages.map(s => <li key={s.key} className="grid grid-cols-[64px_1fr_32px] items-center gap-3 text-sm">
          <span className="text-muted-foreground">{s.label}</span>
          <span className="h-6 overflow-hidden rounded-md bg-muted"><span className={cn("block h-full rounded-md", solidTones[s.tone])} style={{ width: `${Math.max(s.count ? 6 : 0, s.count / max * 100)}%` }} /></span>
          <span className="tabular text-right font-medium">{s.count}</span>
        </li>)}</ul>
      </Panel>
      <Panel title="等待回复" description="已投递、还没有下文的岗位。超过 14 天建议跟进。">
        {waiting.length ? <ul className="flex flex-col gap-2.5">{waiting.slice(0, 8).map(({ e, days }) => <li key={e.id}><button className="grid w-full grid-cols-[minmax(0,140px)_1fr_48px] items-center gap-3 text-left text-sm" onClick={() => openEntry(e.id)}>
          <span className="truncate hover:text-primary">{e.organization}</span>
          <span className="relative h-2 rounded-full bg-muted"><span className={cn("absolute inset-y-0 left-0 rounded-full", days >= 14 ? "bg-amber-500" : "bg-primary/60")} style={{ width: `${days / maxWait * 100}%` }} /><span className="absolute inset-y-[-3px] w-px bg-foreground/30" style={{ left: `${14 / maxWait * 100}%` }} /></span>
          <span className={cn("tabular text-right text-xs", days >= 14 ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{days} 天</span>
        </button></li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">没有正在等待回复的岗位。</p>}
      </Panel>
      <Panel title="综合评分最高" description="个人化的实习价值比较，未知维度不计入，非录用概率">
        {scored.length ? <ul className="flex flex-col gap-2">{scored.map((e, i) => <li key={e.id}><button onClick={() => openEntry(e.id)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left hover:bg-muted/50">
          <span className="tabular w-4 text-xs text-muted-foreground">{i + 1}</span><CompanyMark name={e.organization} src={logoFor(e.organization)} size="sm" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm">{e.title}</span><span className="block truncate text-xs text-muted-foreground">{e.organization}</span></span>
          <span className="tabular text-sm font-semibold">{evalScore(e)!.toFixed(1)}</span>
        </button></li>)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">还没有评分。可以在「岗位评估」里用内置模型评估，或在岗位里手动打分。</p>}
      </Panel>
      <Panel title="岗位匹配度 × 实习发展价值" description="实习发展价值综合职业路径、return offer 与学术帮助；右上角是两方面都较好的岗位">
        {scatter.length ? <div className="h-64"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          <CartesianGrid stroke="var(--border)" />
          <XAxis type="number" dataKey="x" domain={[0, 10]} name="匹配度" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <YAxis type="number" dataKey="y" domain={[0, 10]} name="实习发展价值" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} stroke="var(--border)" />
          <ReferenceLine x={7} stroke="var(--muted-foreground)" strokeDasharray="3 3" /><ReferenceLine y={7} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => payload?.[0] ? <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"><p className="font-medium">{(payload[0].payload as { name: string }).name}</p><p className="text-muted-foreground">匹配 {(payload[0].payload as { x: number }).x} · 实习发展 {(payload[0].payload as { y: number }).y}</p></div> : null} />
          <Scatter data={scatter} onClick={p => openEntry((p as unknown as { id: string }).id)} shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={6} fill="var(--chart-1)" fillOpacity={0.85} stroke="var(--card)" strokeWidth={2} className="cursor-pointer" />} />
        </ScatterChart></ResponsiveContainer></div> : <p className="py-6 text-center text-sm text-muted-foreground">需要有岗位匹配分和至少一项实习发展分（职业路径、Return Offer 或学术帮助）。</p>}
      </Panel>
    </div>
  </div>;
}
