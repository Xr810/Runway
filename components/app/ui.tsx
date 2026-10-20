"use client";
/* eslint-disable @next/next/no-img-element */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type Entry, dayDiff, score } from "@/lib/model";
import { companySymbol, timelineEvents } from "@/lib/journey";
import { defaultReminderPreferences, type ReminderPreferences } from "@/lib/recruiting-reminders";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RECRUITING_TIME_ZONE } from "@/lib/appointments";

// Soft fills for chips; solid fills for dots and bars. Both read the semantic tokens in globals.css.
export const tones = {
  gray: "bg-muted text-muted-foreground",
  blue: "bg-info/10 text-info",
  violet: "bg-violet/10 text-violet",
  amber: "bg-warning/12 text-warning",
  green: "bg-success/10 text-success",
  red: "bg-danger/10 text-danger",
} as const;
export type Tone = keyof typeof tones;
export const solidTones: Record<Tone, string> = {
  gray: "bg-faint",
  blue: "bg-info",
  violet: "bg-violet",
  amber: "bg-warning",
  green: "bg-success",
  red: "bg-danger",
};
export const textTones: Record<Tone, string> = {
  gray: "text-muted-foreground",
  blue: "text-info",
  violet: "text-violet",
  amber: "text-warning",
  green: "text-success",
  red: "text-danger",
};

const statusTone: Record<string, Tone> = {
  待投递: "gray",
  已投递: "blue",
  笔试: "violet",
  AI测评: "violet",
  一面: "amber",
  二面: "amber",
  终面: "amber",
  Offer: "green",
  未通过: "red",
  放弃: "gray",
  关注中: "gray",
  准备报名: "gray",
  已报名: "blue",
  进行中: "amber",
  已提交: "violet",
  获奖: "green",
  已结束: "gray",
  构思中: "gray",
  暂停: "gray",
  已完成: "green",
  已放弃: "gray",
};
export const toneOf = (status: string): Tone => statusTone[status] ?? "gray";

export function Pill({
  tone = "gray",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
/** A status reads as a coloured dot plus plain text, so a list of them stays quiet. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-foreground/85",
        className,
      )}
    >
      <StatusDot tone={toneOf(status)} />
      {status}
    </span>
  );
}
export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-2.5 shrink-0 items-center justify-center rounded-full",
        className,
      )}
    >
      <span className={cn("absolute inset-0 rounded-full opacity-25", solidTones[tone])} />
      <span className={cn("size-1.5 rounded-full", solidTones[tone])} />
    </span>
  );
}

// Pipeline stages group the stored statuses; the statuses themselves are unchanged data values.
export const jobStages = [
  { key: "todo", label: "待投递", statuses: ["待投递"], tone: "gray" },
  { key: "applied", label: "已投递", statuses: ["已投递"], tone: "blue" },
  { key: "test", label: "笔试", statuses: ["笔试"], tone: "violet" },
  { key: "ai-assessment", label: "AI测评", statuses: ["AI测评"], tone: "violet" },
  { key: "interview", label: "面试", statuses: ["一面", "二面", "终面"], tone: "amber" },
  { key: "offer", label: "Offer", statuses: ["Offer"], tone: "green" },
  { key: "rejected", label: "被拒绝", statuses: ["未通过"], tone: "red" },
  { key: "withdrawn", label: "已放弃", statuses: ["放弃"], tone: "gray" },
] as const satisfies readonly {
  key: string;
  label: string;
  statuses: readonly string[];
  tone: Tone;
}[];
export type StageKey = (typeof jobStages)[number]["key"];
export const stageOf = (status: string) =>
  jobStages.find((s) => (s.statuses as readonly string[]).includes(status));

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
export function dueTone(date: string) {
  const diff = dayDiff(date);
  return diff < 0
    ? "text-faint"
    : diff <= 3
      ? "text-danger"
      : diff <= 7
        ? "text-warning"
        : "text-foreground";
}
export function DueLabel({ date, kind }: { date: string; kind?: string }) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className={cn("tabular text-sm font-medium", dueTone(date))}>
        {formatDay(date, false)}
      </span>
      <span className="text-xs text-muted-foreground">
        {kind ? kind + " · " : ""}
        {relativeDay(date)}
      </span>
    </span>
  );
}

const keyDateKinds: Record<string, string> = {
  deadline: "截止",
  followup: "跟进",
  interview: "面试",
  assessment: "测评",
};
/**
 * The date that matters next for this record: the nearest upcoming deadline, follow-up,
 * interview or assessment due date. It reads the same timeline as 今日 and 日程, so an
 * interview in two days is the key date rather than an empty cell. Once a job is applied
 * to, its application deadline no longer counts (handled by timelineEvents).
 */
export function keyDate(e: Entry, preferences: ReminderPreferences = defaultReminderPreferences) {
  const events = timelineEvents([e], preferences).map((event) => ({
    date: event.date,
    kind: keyDateKinds[event.type] ?? event.label,
  }));
  return events.find((event) => dayDiff(event.date) >= 0) ?? events.at(-1) ?? null;
}
const priorityLevel = (priority: string) =>
  /高|P0|P1/.test(priority) ? 3 : /中|P2/.test(priority) ? 2 : /低|P3/.test(priority) ? 1 : 0;
/** Monochrome signal-bar priority, so priority never competes with stage colours. */
export function PriorityIcon({ priority, className }: { priority: string; className?: string }) {
  const level = priorityLevel(priority);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex size-4 shrink-0 items-end justify-center gap-[2px] pb-[3px]",
            className,
          )}
          aria-label={priority ? `优先级 ${priority}` : "未设置优先级"}
        >
          {[1, 2, 3].map((bar) => (
            <span
              key={bar}
              className={cn(
                "w-[3px] rounded-[1px]",
                bar === 1 ? "h-[5px]" : bar === 2 ? "h-[8px]" : "h-[11px]",
                level >= bar
                  ? level === 3
                    ? "bg-foreground"
                    : "bg-muted-foreground"
                  : "bg-border",
              )}
            />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>{priority ? `优先级 ${priority}` : "未设置优先级"}</TooltipContent>
    </Tooltip>
  );
}

export function ScoreValue({
  entry,
  weights,
  className,
}: {
  entry: Entry;
  weights?: Parameters<typeof score>[1];
  className?: string;
}) {
  const value = score(entry, weights);
  if (value === null) return <span className={cn("text-faint", className)}>—</span>;
  const tone =
    value >= 7.5 ? "text-success" : value >= 5 ? "text-foreground" : "text-muted-foreground";
  return <span className={cn("tabular font-semibold", tone, className)}>{value.toFixed(1)}</span>;
}

export function CompanyMark({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(""),
    [loaded, setLoaded] = useState("");
  const sizes = {
    xs: "size-5 text-[9px] rounded",
    sm: "size-6 text-[10px] rounded-md",
    md: "size-8 text-[11px] rounded-md",
    lg: "size-11 text-sm rounded-lg",
  };
  const showImage = !!src && failed !== src;
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border bg-card font-semibold text-muted-foreground",
        sizes[size],
        className,
      )}
      aria-hidden
    >
      {(!showImage || loaded !== src) && companySymbol(name || "?")}
      {showImage && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 size-full bg-white object-contain p-0.5",
            loaded === src ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setLoaded(src!)}
          onError={() => setFailed(src!)}
        />
      )}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="truncate text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Small uppercase-style section label used above lists and property groups. */
export function SectionLabel({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-6 items-center justify-between gap-2", className)}>
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-card-foreground shadow-panel",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-11 items-center justify-between gap-3 border-b px-4 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="shrink-0 text-sm font-semibold">{title}</h2>
            {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  onClick,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  tone?: "default" | "warn" | "good";
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col gap-0.5 px-4 py-3 text-left",
        onClick && "transition-colors hover:bg-muted/60",
      )}
    >
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular text-xl font-semibold tracking-tight",
          tone === "warn" && "text-warning",
          tone === "good" && "text-success",
        )}
      >
        {value}
      </span>
      {hint && <span className="truncate text-xs text-faint">{hint}</span>}
    </Comp>
  );
}
/** A single bordered strip of stats separated by hairlines. */
export function StatStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-border overflow-hidden rounded-lg border bg-card shadow-panel sm:grid-cols-4 sm:divide-x [&>*:nth-child(-n+2)]:max-sm:border-b [&>*:nth-child(odd)]:max-sm:border-r",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-10 text-center",
        className,
      )}
    >
      {icon && <div className="mb-1 text-faint [&_svg]:size-6 [&_svg]:stroke-[1.5]">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-7 w-fit shrink-0 items-center gap-0.5 rounded-md border bg-muted/60 p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-[22px] items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
            value === option.value && "bg-card text-foreground shadow-panel",
          )}
        >
          {option.label}
          {option.count !== undefined && <span className="tabular text-faint">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Facts({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; wide?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3", className)}>
      {items.map((item) => (
        <div key={item.label} className={cn("min-w-0", item.wide && "col-span-2")}>
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 text-sm break-words">
            {item.value || <span className="text-faint">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Linear-style property list: a fixed label column and a value column, one row per field. */
export function Properties({
  items,
  className,
}: {
  items: { label: string; value: ReactNode; hidden?: boolean }[];
  className?: string;
}) {
  return (
    <dl
      className={cn("grid grid-cols-[minmax(84px,max-content)_minmax(0,1fr)] gap-x-4", className)}
    >
      {items
        .filter((item) => !item.hidden)
        .map((item) => (
          <div key={item.label} className="col-span-2 grid grid-cols-subgrid items-start py-1.5">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 text-sm break-words">
              {item.value || <span className="text-faint">未填写</span>}
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** Compact disclosure that a time is Hong Kong time, without repeating a sentence on every row. */
export function HkTime({ time, className }: { time: string; className?: string }) {
  return (
    <span className={cn("tabular", className)} title="香港时间（UTC+8），不随设备时区转换">
      {time}
      <span className="ml-0.5 text-[0.85em] font-normal text-muted-foreground">香港</span>
    </span>
  );
}

export const stamp = (value: string) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        timeZone: RECRUITING_TIME_ZONE,
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "";

// Field wording per record kind, shared by the detail sheet and the editor.
export const kindCopy = {
  job: {
    noun: "岗位",
    title: "岗位名称",
    org: "公司",
    orgEmpty: "公司未填写",
    location: "工作地点",
    url: "原始链接",
    text: "JD 原文",
    textHint: "保存完整原文，岗位下线后仍能查看。修改会保留历史版本。",
    deadline: "截止",
    followUp: "跟进",
    applied: "投递",
    salary: "薪资",
    next: "例如：准备 Coding 笔试",
  },
  competition: {
    noun: "比赛",
    title: "比赛名称",
    org: "主办方",
    orgEmpty: "主办方未填写",
    location: "地点",
    url: "比赛链接",
    text: "比赛规则",
    textHint: "保存完整规则，页面下线后仍能查看。修改会保留历史版本。",
    deadline: "截止",
    followUp: "跟进",
    applied: "报名",
    salary: "奖励",
    next: "例如：提交第一版方案",
  },
  project: {
    noun: "项目",
    title: "项目名称",
    org: "团队 / 合作方（可选）",
    orgEmpty: "个人项目",
    location: "地点",
    url: "项目链接（仓库、网站）",
    text: "项目说明",
    textHint: "项目背景、目标、技术栈、相关链接。修改会保留历史版本。",
    deadline: "目标日期",
    followUp: "下次检查",
    applied: "开始",
    salary: "",
    next: "例如：完成用户登录",
  },
} as const;
