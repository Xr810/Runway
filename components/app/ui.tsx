"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type Entry, dayDiff, score } from "@/lib/model";
import { companySymbol } from "@/lib/journey";

export const tones = {
  gray: "bg-muted text-muted-foreground ring-border",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-400/10 dark:text-violet-300 dark:ring-violet-400/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/20",
} as const;
export type Tone = keyof typeof tones;
export const solidTones: Record<Tone, string> = { gray: "bg-zinc-400 dark:bg-zinc-500", blue: "bg-blue-500", violet: "bg-violet-500", amber: "bg-amber-500", green: "bg-emerald-500", red: "bg-red-400" };

const statusTone: Record<string, Tone> = {
  待投递: "gray", 已投递: "blue", 笔试: "violet", 一面: "amber", 二面: "amber", 终面: "amber", Offer: "green", 未通过: "red", 放弃: "gray",
  关注中: "gray", 准备报名: "gray", 已报名: "blue", 进行中: "amber", 已提交: "violet", 获奖: "green", 已结束: "gray",
  构思中: "gray", 暂停: "gray", 已完成: "green", 已放弃: "gray",
};
export const toneOf = (status: string): Tone => statusTone[status] ?? "gray";

export function Pill({ tone = "gray", children, className, dot = false }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset", tones[tone], className)}>
    {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}{children}
  </span>;
}
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <Pill tone={toneOf(status)} dot className={className}>{status}</Pill>;
}

// Pipeline stages group the stored statuses; the statuses themselves are unchanged data values.
export const jobStages = [
  { key: "todo", label: "待投递", statuses: ["待投递"], tone: "gray" },
  { key: "applied", label: "已投递", statuses: ["已投递"], tone: "blue" },
  { key: "test", label: "笔试", statuses: ["笔试"], tone: "violet" },
  { key: "interview", label: "面试", statuses: ["一面", "二面", "终面"], tone: "amber" },
  { key: "offer", label: "Offer", statuses: ["Offer"], tone: "green" },
  { key: "closed", label: "已结束", statuses: ["未通过", "放弃"], tone: "red" },
] as const satisfies readonly { key: string; label: string; statuses: readonly string[]; tone: Tone }[];
export type StageKey = (typeof jobStages)[number]["key"];
export const stageOf = (status: string) => jobStages.find(s => (s.statuses as readonly string[]).includes(status));

const weekday = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", weekday: "short" });
export function formatDay(date: string, withWeekday = true) {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return `${m}月${d}日` + (withWeekday ? " " + weekday.format(new Date(date + "T00:00:00Z")) : "");
}
export function relativeDay(date: string) {
  const diff = dayDiff(date);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === -1) return "昨天";
  return diff > 0 ? `${diff} 天后` : `${-diff} 天前`;
}
export function DueLabel({ date, kind }: { date: string; kind?: string }) {
  const diff = dayDiff(date);
  const tone = diff < 0 ? "text-muted-foreground line-through decoration-muted-foreground/40" : diff <= 3 ? "text-red-600 dark:text-red-400" : diff <= 7 ? "text-amber-700 dark:text-amber-400" : "text-foreground";
  return <span className="inline-flex flex-col leading-tight">
    <span className={cn("tabular text-[13px] font-medium", tone)}>{formatDay(date, false)}</span>
    <span className="text-xs text-muted-foreground">{kind ? kind + " · " : ""}{relativeDay(date)}</span>
  </span>;
}

export function ScoreValue({ entry, weights, className }: { entry: Entry; weights?: Parameters<typeof score>[1]; className?: string }) {
  const value = score(entry, weights);
  if (value === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const tone = value >= 7.5 ? "text-emerald-700 dark:text-emerald-400" : value >= 5 ? "text-foreground" : "text-muted-foreground";
  return <span className={cn("tabular font-semibold", tone, className)}>{value.toFixed(1)}</span>;
}

export function CompanyMark({ name, src, size = "md", className }: { name: string; src?: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const [failed, setFailed] = useState(""), [loaded, setLoaded] = useState("");
  const sizes = { sm: "size-7 text-[10px] rounded-md", md: "size-9 text-xs rounded-lg", lg: "size-12 text-sm rounded-xl" };
  const showImage = !!src && failed !== src;
  return <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted font-semibold text-muted-foreground ring-1 ring-inset ring-border", sizes[size], className)} aria-hidden>
    {(!showImage || loaded !== src) && companySymbol(name || "?")}
    {showImage && <img src={src} alt="" referrerPolicy="no-referrer" className={cn("absolute inset-0 size-full bg-white object-contain p-1", loaded === src ? "opacity-100" : "opacity-0")} onLoad={() => setLoaded(src!)} onError={() => setFailed(src!)} />}
  </span>;
}

export function PageHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <header className="flex flex-col gap-4 pb-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
    {children}
  </header>;
}

export function Panel({ title, description, action, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return <section className={cn("rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>
    {(title || action) && <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}</div>
      {action}
    </div>}
    <div className={cn("p-4", bodyClassName)}>{children}</div>
  </section>;
}

export function Stat({ label, value, hint, onClick, tone }: { label: string; value: ReactNode; hint?: ReactNode; onClick?: () => void; tone?: "default" | "warn" | "good" }) {
  const Comp = onClick ? "button" : "div";
  return <Comp onClick={onClick} className={cn("flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)]", onClick && "transition-colors hover:border-primary/40 hover:bg-accent/40")}>
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <span className={cn("tabular text-2xl font-semibold tracking-tight", tone === "warn" && "text-amber-700 dark:text-amber-400", tone === "good" && "text-emerald-700 dark:text-emerald-400")}>{value}</span>
    {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
  </Comp>;
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center", className)}>
    {icon && <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</div>}
    <p className="text-sm font-medium">{title}</p>
    {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>;
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (value: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return <div role="tablist" className={cn("inline-flex h-8 w-fit shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
    {options.map(option => <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5", value === option.value && "bg-card text-foreground shadow-sm")}>
      {option.label}{option.count !== undefined && <span className="tabular text-muted-foreground">{option.count}</span>}
    </button>)}
  </div>;
}

export function Facts({ items, className }: { items: { label: string; value: ReactNode; wide?: boolean }[]; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3.5", className)}>
    {items.map(item => <div key={item.label} className={cn("min-w-0", item.wide && "col-span-2")}>
      <dt className="text-xs text-muted-foreground">{item.label}</dt>
      <dd className="mt-0.5 text-sm break-words">{item.value || <span className="text-muted-foreground">—</span>}</dd>
    </div>)}
  </dl>;
}

export const stamp = (value: string) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Singapore", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

// Field wording per record kind, shared by the detail sheet and the editor.
export const kindCopy = {
  job: { noun: "岗位", title: "岗位名称", org: "公司", orgEmpty: "公司未填写", location: "工作地点", url: "原始链接", text: "JD 原文", textHint: "保存完整原文，岗位下线后仍能查看。修改会保留历史版本。", deadline: "截止", followUp: "跟进", applied: "投递", salary: "薪资", next: "例如：准备 Coding 笔试" },
  competition: { noun: "比赛", title: "比赛名称", org: "主办方", orgEmpty: "主办方未填写", location: "地点", url: "比赛链接", text: "比赛规则", textHint: "保存完整规则，页面下线后仍能查看。修改会保留历史版本。", deadline: "截止", followUp: "跟进", applied: "报名", salary: "奖励", next: "例如：提交第一版方案" },
  project: { noun: "项目", title: "项目名称", org: "团队 / 合作方（可选）", orgEmpty: "个人项目", location: "地点", url: "项目链接（仓库、网站）", text: "项目说明", textHint: "项目背景、目标、技术栈、相关链接。修改会保留历史版本。", deadline: "目标日期", followUp: "下次检查", applied: "开始", salary: "", next: "例如：完成用户登录" },
} as const;
