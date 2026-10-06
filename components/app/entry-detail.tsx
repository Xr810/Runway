"use client";
import { useRef, useState } from "react";
import {
  CalendarClock,
  Clock3,
  Download,
  Flag,
  LoaderCircle as Spinner,
  MoreHorizontal,
  Trash2,
  ExternalLink,
  FileText,
  LoaderCircle,
  Paperclip,
  Pencil,
  Plus,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { type Entry, score, statusesFor } from "@/lib/model";
import { appointmentDate, appointmentTime, stageDueDate, stageProgress } from "@/lib/appointments";
import { effectiveFollowUp } from "@/lib/recruiting-reminders";
import { today } from "@/lib/model";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDesk } from "./store";
import {
  CompanyMark,
  EmptyState,
  Facts,
  Pill,
  ScoreValue,
  formatDay,
  kindCopy,
  relativeDay,
  toneOf,
  StatusBadge,
} from "./ui";
import { KindIcon } from "./views/projects";
import { EvaluationTimeline, useEnrichment } from "./evaluation";
import ProgressDialog, { newProgress, type ProgressDraft } from "./progress-dialog";
import { JdSummary } from "./jd-summary";
import { AssessmentAccess } from "./assessment-access";

function download(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
export const jdLabel = (e: Entry) =>
  e.jdStatus === "complete" ? "完整原文" : e.jdStatus === "partial" ? "部分内容" : "未保存";
const appointmentStatus = { scheduled: "已预约", completed: "已完成", cancelled: "已取消" };

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function DateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {value ? (
        <>
          <p className="tabular mt-0.5 text-sm font-medium">{formatDay(value)}</p>
          <p className="text-xs text-muted-foreground">{relativeDay(value)}</p>
        </>
      ) : (
        <p className="mt-0.5 text-sm text-muted-foreground">未设置</p>
      )}
    </div>
  );
}

export default function EntryDetail() {
  const {
    selected: entry,
    selectedLoading,
    closeEntry,
    editEntry,
    data,
    patchEntry,
    removeEntry,
    upload,
    logoFor,
    reload,
  } = useDesk();
  // Composite scores follow the same custom weights as 洞察 (#6).
  const { feed } = useEnrichment();
  const weights = feed?.profile.evaluationWeights;
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<ProgressDraft | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const isJob = entry?.kind === "job",
    copy = kindCopy[entry?.kind ?? "job"];
  const effective = entry ? effectiveFollowUp(entry, data.reminderPreferences) : null;
  const followUp = isJob ? effective?.date || "" : entry?.followUp || "";
  const TextContainer = isJob ? "details" : "div";
  async function changeStatus(status: string) {
    if (!entry || status === entry.status) return;
    setBusy(true);
    try {
      await patchEntry(entry, { status });
      toast.success("状态已更新为 " + status);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function attach(file: File) {
    if (!entry) return;
    setBusy(true);
    try {
      await upload(entry.id, file);
      toast.success("附件已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const files = entry ? data.files.filter((f) => f.entry_id === entry.id) : [];
  return (
    <>
      <Sheet
        open={!!entry}
        onOpenChange={(open) => {
          if (!open) closeEntry();
        }}
      >
        <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[640px]">
          {entry && (
            <>
              <div className="sticky top-0 z-10 border-b bg-background/95 px-6 pt-6 pb-4 backdrop-blur">
                <div className="flex items-start gap-3 pr-8">
                  {isJob ? (
                    <CompanyMark
                      name={entry.organization || entry.title}
                      src={logoFor(entry.organization)}
                      size="lg"
                    />
                  ) : (
                    <KindIcon kind={entry.kind} className="size-12 rounded-xl [&_svg]:size-5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-lg leading-snug font-semibold">
                      {entry.title}
                    </SheetTitle>
                    <SheetDescription className="mt-0.5">
                      {copy.noun} · {entry.organization || copy.orgEmpty}
                      {entry.location ? " · " + entry.location : ""}
                    </SheetDescription>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Select
                    value={entry.status}
                    onValueChange={(v) => void changeStatus(v)}
                    disabled={busy}
                  >
                    <SelectTrigger size="sm" aria-label="更改状态" className="h-8 w-auto gap-2">
                      <SelectValue>{<StatusBadge status={entry.status} />}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {statusesFor(entry.kind).map((s) => (
                        <SelectItem key={s} value={s}>
                          <Pill tone={toneOf(s)} dot>
                            {s}
                          </Pill>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {entry.priority && (
                    <Pill tone={entry.priority.includes("高") ? "red" : "gray"}>
                      优先级 {entry.priority}
                    </Pill>
                  )}
                  {isJob && score(entry, weights) !== null && (
                    <Pill tone="blue">
                      综合 <ScoreValue entry={entry} weights={weights} />
                    </Pill>
                  )}
                  <div className="ml-auto flex gap-2">
                    {entry.url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={entry.url} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          {entry.kind === "project" ? "打开项目" : "原始页面"}
                        </a>
                      </Button>
                    )}
                    <Button size="sm" onClick={() => editEntry(entry)}>
                      <Pencil />
                      编辑
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label="更多操作">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => {
                            if (
                              window.confirm(
                                `删除「${entry.title}」？删除后可以在「设置 → 数据与备份」的回收站里恢复。`,
                              )
                            )
                              void removeEntry(entry).catch((e) =>
                                toast.error((e as Error).message),
                              );
                          }}
                        >
                          <Trash2 />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
              <Tabs key={entry.id} defaultValue="overview" className="gap-0">
                <div className="border-b px-6">
                  <TabsList variant="line" className="h-10">
                    <TabsTrigger value="overview">概览</TabsTrigger>
                    <TabsTrigger value="text">{isJob ? "摘要" : copy.text}</TabsTrigger>
                    {isJob ? (
                      <TabsTrigger value="evaluation">评估</TabsTrigger>
                    ) : (
                      <TabsTrigger value="progress">
                        进度与里程碑{" "}
                        <span className="tabular text-muted-foreground">
                          {entry.progress.length}
                        </span>
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="files">
                      附件{" "}
                      {files.length > 0 && (
                        <span className="tabular text-muted-foreground">{files.length}</span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>
                <div className="px-6 py-6">
                  <TabsContent value="overview" className="flex flex-col gap-7">
                    {(entry.nextAction || followUp) && (
                      <div className="rounded-xl border border-primary/20 bg-accent/60 px-4 py-3">
                        <p className="text-xs font-medium text-accent-foreground/80">下一步</p>
                        <p className="mt-0.5 text-sm font-medium">{entry.nextAction || "跟进"}</p>
                        {followUp && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            计划 {formatDay(followUp)} · {relativeDay(followUp)}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <DateCell
                        label={entry.kind === "project" ? "目标日期" : "截止日期"}
                        value={entry.deadline}
                      />
                      <DateCell
                        label={
                          copy.followUp +
                          "日期" +
                          (effective
                            ? effective.source === "manual"
                              ? "（手动）"
                              : "（自动）"
                            : "")
                        }
                        value={followUp}
                      />
                      <DateCell label={copy.applied + "日期"} value={entry.applied} />
                    </div>
                    {isJob && !effective && (
                      <p className="text-xs text-muted-foreground">
                        暂无可计算的跟进日期：请核对阶段日期、反馈状态及提醒设置，或设置手动跟进。自动跟进不会从缺失日期推算。
                      </p>
                    )}
                    {entry.appointments.length > 0 && (
                      <Section title="面试与笔试">
                        <ul className="flex flex-col gap-2">
                          {entry.appointments
                            .toSorted((a, b) => a.startsAt.localeCompare(b.startsAt))
                            .map((item) => {
                              const due =
                                  effective?.appointmentId === item.id ? effective.date : undefined,
                                progress = stageProgress(
                                  item,
                                  today(),
                                  due,
                                  data.reminderPreferences.assessment.planDays,
                                );
                              return (
                                <li
                                  key={item.id}
                                  className="flex gap-3 rounded-lg border bg-card px-3 py-2.5"
                                >
                                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">{item.title}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {item.type === "assessment"
                                        ? `通知 ${formatDay(item.receivedDate) || "未设置"} · ${item.deadlineDate ? "公司截止" : "应用计划期限"} ${formatDay(stageDueDate(item, data.reminderPreferences.assessment.planDays)) || "未设置（缺少通知日期）"}${item.completedAt ? ` · 完成 ${formatDay(appointmentDate(item.completedAt))}` : ""}`
                                        : `${formatDay(appointmentDate(item.startsAt))} ${appointmentTime(item.startsAt)}${item.endsAt ? "–" + appointmentTime(item.endsAt) : ""}`}
                                      {item.location ? " · " + item.location : ""}
                                    </p>
                                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-muted">
                                      <div
                                        className="h-full bg-primary"
                                        style={{ width: `${progress.percent}%` }}
                                      />
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {progress.label}
                                    </p>
                                    {isJob && item.type === "assessment" ? (
                                      <AssessmentAccess
                                        key={`${entry.id}:${item.id}`}
                                        entryId={entry.id}
                                        appointmentId={item.id}
                                        url={item.url}
                                      />
                                    ) : (
                                      item.url && (
                                        <a
                                          className="text-xs text-primary hover:underline"
                                          href={item.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          打开日程链接
                                        </a>
                                      )
                                    )}
                                  </div>
                                  <Pill
                                    tone={
                                      item.status === "completed"
                                        ? "green"
                                        : item.status === "cancelled"
                                          ? "gray"
                                          : "blue"
                                    }
                                  >
                                    {appointmentStatus[item.status]}
                                  </Pill>
                                </li>
                              );
                            })}
                        </ul>
                      </Section>
                    )}
                    <Section title="详情">
                      <Facts
                        items={
                          isJob
                            ? [
                                { label: "投递渠道", value: entry.applicationChannel },
                                {
                                  label: "投递链接",
                                  value: entry.applicationUrl && (
                                    <a
                                      className="break-all select-text text-primary hover:underline"
                                      href={entry.applicationUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {entry.applicationUrl}
                                      <ExternalLink className="ml-1 inline size-3" />
                                    </a>
                                  ),
                                },
                                { label: "工作地点", value: entry.location },
                                { label: "工作模式", value: entry.workMode },
                                { label: "岗位类型", value: entry.employmentType },
                                { label: "工作时间", value: entry.schedule },
                                { label: "薪资", value: entry.salary },
                                { label: "公司所属国家／地区", value: entry.companyCountry },
                              ]
                            : entry.kind === "project"
                              ? [
                                  {
                                    label: "项目链接",
                                    value: entry.url && (
                                      <a
                                        className="inline-flex items-center gap-1 break-all text-primary hover:underline"
                                        href={entry.url}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {entry.url.replace(/^https?:\/\//, "")}
                                        <ExternalLink className="size-3 shrink-0" />
                                      </a>
                                    ),
                                    wide: true,
                                  },
                                  { label: "团队 / 合作方", value: entry.organization },
                                  { label: "优先级", value: entry.priority },
                                ]
                              : [
                                  { label: "地点", value: entry.location },
                                  { label: "奖励", value: entry.salary },
                                  {
                                    label: "报名链接",
                                    value: entry.applicationUrl && (
                                      <a
                                        className="text-primary hover:underline"
                                        href={entry.applicationUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        打开
                                      </a>
                                    ),
                                  },
                                ]
                        }
                      />
                    </Section>
                    {isJob && (
                      <Section title="公司介绍">
                        <div className="rounded-lg border bg-card px-3 py-2.5">
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">
                            {entry.companyDescription || "暂无公司介绍，可在编辑中补充。"}
                          </p>
                        </div>
                      </Section>
                    )}
                    {!isJob && entry.notes && (
                      <Section title="备注">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.notes}</p>
                      </Section>
                    )}
                    {!isJob && Object.keys(entry.extra).length > 0 && (
                      <details className="group rounded-lg border bg-card">
                        <summary className="cursor-pointer px-3 py-2.5 text-xs text-muted-foreground">
                          导入时的原始字段
                        </summary>
                        <dl className="flex flex-col gap-3 border-t px-3 py-3">
                          {Object.entries(entry.extra).map(([k, v]) => (
                            <div key={k}>
                              <dt className="text-xs text-muted-foreground">{k}</dt>
                              <dd className="mt-0.5 text-xs whitespace-pre-wrap break-words">
                                {typeof v === "string" ? v : JSON.stringify(v, null, 2)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    )}
                  </TabsContent>
                  <TabsContent value="text" className="flex flex-col gap-4">
                    {isJob && (
                      <Section title="摘要">
                        <JdSummary
                          key={`${entry.id}:${entry.revision}`}
                          entryId={entry.id}
                          fallback={entry.summary}
                        />
                      </Section>
                    )}
                    <TextContainer className={isJob ? "rounded-lg border bg-card" : "contents"}>
                      {isJob && (
                        <summary className="cursor-pointer px-4 py-3 text-sm">
                          JD 原文{!selectedLoading && !entry.jd ? "（暂无）" : ""}
                        </summary>
                      )}
                      <div className={isJob ? "flex flex-col gap-4 border-t p-4" : "contents"}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill
                            tone={
                              entry.jdStatus === "complete"
                                ? "green"
                                : entry.jdStatus === "partial"
                                  ? "amber"
                                  : "gray"
                            }
                          >
                            {jdLabel(entry)}
                          </Pill>
                          {entry.jd && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ml-auto"
                              onClick={() =>
                                download(
                                  new Blob([entry.title + "\n" + entry.url + "\n\n" + entry.jd], {
                                    type: "text/plain;charset=utf-8",
                                  }),
                                  entry.title + ".txt",
                                )
                              }
                            >
                              <Download />
                              下载
                            </Button>
                          )}
                        </div>
                        {selectedLoading ? (
                          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                            <Spinner className="size-4 animate-spin" />
                            正在读取全文…
                          </p>
                        ) : entry.jd ? (
                          <article className="rounded-xl border bg-card px-5 py-4 text-sm leading-7 whitespace-pre-wrap break-words">
                            {entry.jd}
                          </article>
                        ) : isJob ? (
                          <p className="text-sm text-muted-foreground">暂无 JD 原文。</p>
                        ) : (
                          <EmptyState
                            icon={<FileText />}
                            title={"还没有" + copy.text}
                            description={copy.textHint}
                            action={
                              <Button size="sm" variant="outline" onClick={() => editEntry(entry)}>
                                <Pencil />
                                编辑
                              </Button>
                            }
                          />
                        )}
                        {isJob && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="self-start"
                            onClick={() => editEntry(entry)}
                          >
                            <Pencil />
                            编辑
                          </Button>
                        )}
                      </div>
                    </TextContainer>
                    {!isJob && entry.summary && (
                      <details open={!entry.jd} className="rounded-lg border bg-card">
                        <summary className="cursor-pointer px-3 py-2.5 text-xs text-muted-foreground">
                          摘要 / 摘录
                        </summary>
                        <p className="border-t px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                          {entry.summary}
                        </p>
                      </details>
                    )}
                  </TabsContent>
                  {isJob && (
                    <TabsContent value="evaluation" className="flex flex-col gap-5">
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {(
                          [
                            ["综合", score(entry, weights)],
                            ["岗位匹配度", entry.fit],
                            ["职业路径与成长", entry.career],
                            ["Return Offer / 转正", entry.returnOffer],
                            ["学术与升学帮助", entry.academic],
                            ["公司 / 行业前景", entry.outlook],
                          ] as const
                        ).map(([label, value], i) => (
                          <div
                            key={label}
                            className={
                              i === 0
                                ? "rounded-lg bg-primary px-3 py-2.5 text-primary-foreground"
                                : "rounded-lg border bg-card px-3 py-2.5"
                            }
                          >
                            <p
                              className={
                                i === 0 ? "text-xs opacity-80" : "text-xs text-muted-foreground"
                              }
                            >
                              {label}
                            </p>
                            <p className="tabular mt-0.5 text-xl font-semibold">
                              {value === null ? "—" : (value.toFixed?.(1) ?? value)}
                            </p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        手动修改分数会自动锁定当前结果，防止被自动评估覆盖。
                      </p>
                      <EvaluationTimeline
                        key={entry.id}
                        target={{ kind: "job", id: entry.id }}
                        onSaved={() => void reload()}
                        compact
                      />
                    </TabsContent>
                  )}
                  {!isJob && (
                    <TabsContent value="progress" className="flex flex-col gap-4">
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setProgress(newProgress(entry))}>
                          <Plus />
                          记录进度
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setProgress(newProgress(entry, undefined, undefined, true))
                          }
                        >
                          <Flag />
                          记录里程碑
                        </Button>
                      </div>
                      {entry.progress.length ? (
                        <ol className="relative flex flex-col gap-4 border-l pl-5">
                          {entry.progress
                            .toSorted((a, b) => b.date.localeCompare(a.date))
                            .map((log) => (
                              <li key={log.id} className="relative">
                                {log.milestone ? (
                                  <Flag className="absolute top-0.5 -left-[29px] size-4 rounded-full bg-background fill-amber-500 p-0.5 text-amber-500" />
                                ) : (
                                  <span className="absolute top-1.5 -left-[25px] size-2 rounded-full bg-primary ring-4 ring-background" />
                                )}
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span className="tabular font-medium text-foreground">
                                    {formatDay(log.date)}
                                  </span>
                                  {log.milestone && <Pill tone="amber">里程碑</Pill>}
                                  {log.track && <Pill>{log.track}</Pill>}
                                  {log.minutes > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                      <Clock3 className="size-3" />
                                      {log.minutes} 分钟
                                    </span>
                                  )}
                                  <button
                                    className="ml-auto text-primary hover:underline"
                                    onClick={() => setProgress(newProgress(entry, log.date, log))}
                                  >
                                    编辑
                                  </button>
                                </div>
                                <p
                                  className={
                                    log.milestone
                                      ? "mt-1 text-sm leading-relaxed font-medium whitespace-pre-wrap"
                                      : "mt-1 text-sm leading-relaxed whitespace-pre-wrap"
                                  }
                                >
                                  {log.text}
                                </p>
                              </li>
                            ))}
                        </ol>
                      ) : (
                        <EmptyState
                          icon={<Clock3 />}
                          title="还没有记录"
                          description="每次推进都记一笔；上线、发布、晋级这类节点可以标记为里程碑。"
                        />
                      )}
                    </TabsContent>
                  )}
                  <TabsContent value="files" className="flex flex-col gap-7">
                    <Section
                      title="附件"
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => uploadRef.current?.click()}
                        >
                          {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}上传
                        </Button>
                      }
                    >
                      <input
                        hidden
                        ref={uploadRef}
                        type="file"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void attach(f);
                          e.target.value = "";
                        }}
                      />
                      {files.length ? (
                        <ul className="overflow-hidden rounded-lg border bg-card">
                          {files.map((f) => (
                            <li key={f.id} className="border-b last:border-b-0">
                              <a
                                href={"/api/desk?file=" + f.id}
                                className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
                              >
                                <Paperclip className="size-4 text-muted-foreground" />
                                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                                <span className="tabular text-xs text-muted-foreground">
                                  {Math.max(1, Math.round(f.size / 1024))} KB
                                </span>
                                <Download className="size-4 text-muted-foreground" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          还没有附件。简历版本、截图、确认邮件都可以放在这里（单个文件最大 15 MB）。
                        </p>
                      )}
                    </Section>
                  </TabsContent>
                </div>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ProgressDialog draft={progress} onChange={setProgress} />
    </>
  );
}
