"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, CheckCheck, ChevronDown, Inbox, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { appointmentDate, appointmentTime } from "@/lib/appointments";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useDesk, readJson, postJson, type NoticeFeed } from "./store";
import { EmptyState, Pill, Segmented, stamp, type Tone } from "./ui";

const labels: Record<string, string> = { evaluation: "评估分数", logo: "官方图标", status: "状态", title: "岗位", organization: "公司", appointments: "面试 / 笔试", nextAction: "下一步", deadline: "截止日期", followUp: "跟进日期", applied: "投递日期", notes: "备注", url: "岗位链接", jd: "JD 原文", summary: "摘要", applicationChannel: "投递渠道", applicationUrl: "投递链接", location: "工作地点", salary: "薪资", workMode: "工作模式", employmentType: "岗位类型", schedule: "工作时间", companyType: "公司类型", companyBasis: "分类依据", companySource: "分类来源", priority: "优先级", jdStatus: "原文完整度" };
const actions: Record<string, { label: string; tone: Tone }> = { assessment: { label: "岗位评估", tone: "violet" }, brand: { label: "图标", tone: "gray" }, create_job: { label: "新岗位", tone: "green" }, notify: { label: "待核对", tone: "amber" }, update_job: { label: "申请更新", tone: "blue" } };
const sources: Record<string, string> = { email: "邮件", website: "招聘网站", manual: "手动同步" };
function display(value: unknown) {
  if (value === null || value === "") return "未填写";
  if (Array.isArray(value)) return value.length ? value.map(item => typeof item === "object" && item ? `${item.title || "日程"} · ${item.startsAt ? appointmentDate(item.startsAt) + " " + appointmentTime(item.startsAt) : ""} · ${({ scheduled: "已预约", completed: "已完成", cancelled: "已取消" } as Record<string, string>)[item.status] || item.status || ""}` : String(item)).join("\n") : "无";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export default function NotificationsSheet() {
  const { notificationsOpen: open, setNotificationsOpen, refreshNotifications, openEntry } = useDesk();
  const [view, setView] = useState<"inbox" | "history">("inbox"), [feed, setFeed] = useState<NoticeFeed>({ items: [], unread: 0, latest: "0", nextBefore: null }), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setFeed(await readJson<NoticeFeed>(await fetch("/api/notifications?history=" + (view === "history"), { cache: "no-store" }))); setError(""); } catch (e) { setError((e as Error).message); }
  }, [view]);
  useEffect(() => { if (open) void Promise.resolve().then(load); }, [open, load]);
  async function act(action: "read" | "dismiss", ids: string[]) {
    if (!ids.length || busy) return; setBusy(true);
    try { await postJson("/api/notifications", { action, ids }); await load(); await refreshNotifications(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function more() {
    if (!feed.nextBefore || busy) return; setBusy(true);
    try { const next = await readJson<NoticeFeed>(await fetch(`/api/notifications?history=${view === "history"}&before=${feed.nextBefore}`, { cache: "no-store" })); setFeed(c => ({ ...next, items: [...c.items, ...next.items.filter(i => !c.items.some(o => o.id === i.id))] })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Sheet open={open} onOpenChange={setNotificationsOpen}>
    <SheetContent className="w-full gap-0 p-0 sm:max-w-md">
      <div className="border-b px-5 pt-5 pb-4">
        <SheetTitle>通知</SheetTitle>
        <SheetDescription className="mt-1">内置 AI 和外部自动化写入的更新都会记录在这里。</SheetDescription>
        <div className="mt-4 flex items-center gap-2">
          <Segmented value={view} onChange={setView} options={[{ value: "inbox", label: "收件箱", count: feed.unread || undefined }, { value: "history", label: "全部历史" }]} />
          <Button variant="ghost" size="sm" className="ml-auto" disabled={busy || !feed.items.some(i => !i.read)} onClick={() => void act("read", feed.items.filter(i => !i.read).map(i => i.id).slice(0, 100))}><CheckCheck />全部已读</Button>
        </div>
      </div>
      {error && <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-400/10 dark:text-red-300">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!feed.items.length ? <EmptyState icon={<Inbox />} title={view === "history" ? "还没有任何更新" : "收件箱是空的"} description="自动扫描、岗位评估和外部同步的更新会出现在这里。" className="m-5" />
          : <ul>{feed.items.map(item => { const a = actions[item.action] ?? actions.update_job; return <li key={item.id} className={cn("group relative border-b px-5 py-4", !item.read && "bg-accent/40")}>
            {!item.read && <span className="absolute top-5 left-2 size-1.5 rounded-full bg-primary" aria-label="未读" />}
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Pill tone={a.tone}>{a.label}</Pill><span className="truncate">{item.actor}</span><time className="ml-auto shrink-0">{stamp(item.created)}</time>
              {!item.dismissed && <button aria-label="清除这条通知" disabled={busy} className="-mr-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100" onClick={() => void act("dismiss", [item.id])}><X className="size-3.5" /></button>}</div>
            <p className="mt-2 text-sm font-medium">{item.organization ? item.organization + " · " : ""}{item.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{item.summary}</p>
            <p className="mt-1.5 text-xs text-muted-foreground">{sources[item.source.kind] ?? item.source.kind} · {item.source.subject || item.source.id}{item.source.url && <a className="ml-1.5 text-primary hover:underline" href={item.source.url} target="_blank" rel="noreferrer">来源</a>}</p>
            {item.changes.length > 0 && <details className="mt-2 text-xs"><summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground"><ChevronDown className="size-3" />{item.changes.length} 项改动</summary>
              <div className="mt-2 flex flex-col gap-2">{item.changes.map(c => <div key={c.field} className="rounded-lg border bg-card p-2.5"><p className="font-medium">{labels[c.field] || c.field}</p>
                <div className="mt-1.5 grid grid-cols-2 gap-2"><pre className="max-h-32 overflow-auto rounded bg-muted p-2 font-sans whitespace-pre-wrap text-muted-foreground line-through decoration-muted-foreground/40">{display(c.before)}</pre><pre className="max-h-32 overflow-auto rounded bg-emerald-50 p-2 font-sans whitespace-pre-wrap dark:bg-emerald-400/10">{display(c.after)}</pre></div></div>)}</div></details>}
            <div className="mt-2.5 flex gap-2">
              {item.entryId && <Button size="xs" variant="outline" disabled={busy} onClick={() => { openEntry(item.entryId!); setNotificationsOpen(false); void act("read", [item.id]); }}>查看记录<ArrowUpRight /></Button>}
              {!item.read && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void act("read", [item.id])}>标为已读</Button>}
              {item.dismissed && <span className="text-xs text-muted-foreground">已清除</span>}
            </div>
          </li>; })}</ul>}
        {feed.nextBefore && <div className="p-4"><Button variant="ghost" size="sm" className="w-full" disabled={busy} onClick={() => void more()}>加载更多</Button></div>}
      </div>
    </SheetContent>
  </Sheet>;
}
