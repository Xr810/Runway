import { z } from "zod";
import { type Entry, today } from "./model";
import { appointmentTime, stageDueDate } from "./appointments";
import {
  recruitingReminders,
  defaultReminderPreferences,
  type ReminderPreferences,
} from "./recruiting-reminders";
const webUrl = z
  .string()
  .max(4000)
  .refine(
    (v) =>
      !v ||
      (URL.canParse(v) && /^https?:\/\//i.test(v) && !new URL(v).username && !new URL(v).password),
    "请输入完整的网站地址",
  )
  .default("");
const logoUrl = z
  .string()
  .max(4000)
  .refine(
    (v) =>
      !v ||
      /^\/api\/brand-assets\/[a-f0-9-]{36}$/.test(v) ||
      (URL.canParse(v) && new URL(v).protocol === "https:"),
    "标志图片请使用 HTTPS 地址或上传图片",
  )
  .default("");
export const channelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  url: webUrl,
  logoUrl,
});
export const companyProfileSchema = z.object({
  name: z.string().trim().min(1).max(2000),
  website: webUrl,
  logoUrl,
});
export const directorySchema = z.object({
  revision: z.number().int().min(0).default(0),
  channels: z.array(channelSchema).max(500).default([]),
  companies: z.array(companyProfileSchema).max(2000).default([]),
});
export type Directory = z.infer<typeof directorySchema>;
export const defaultChannels = [
  { name: "公司官网", url: "", logoUrl: "" },
  { name: "Indeed", url: "https://www.indeed.com", logoUrl: "" },
  { name: "JobsDB", url: "https://hk.jobsdb.com", logoUrl: "" },
];
export const identity = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
export function allChannels(entries: Entry[], directory: Directory) {
  const map = new Map(defaultChannels.map((item) => [identity(item.name), item]));
  for (const e of entries.filter((e) => e.kind === "job" && e.applicationChannel))
    if (!map.has(identity(e.applicationChannel)))
      map.set(identity(e.applicationChannel), { name: e.applicationChannel, url: "", logoUrl: "" });
  for (const item of directory.channels) map.set(identity(item.name), item);
  return [...map.values()];
}
export function groupCompanies(entries: Entry[]) {
  const groups = new Map<string, { key: string; name: string; entries: Entry[] }>();
  for (const entry of entries.filter((e) => e.kind === "job")) {
    const name = entry.organization.trim() || "公司未填写",
      key = identity(name);
    if (!groups.has(key)) groups.set(key, { key, name, entries: [] });
    groups.get(key)!.entries.push(entry);
  }
  return [...groups.values()].sort(
    (a, b) => b.entries.length - a.entries.length || a.name.localeCompare(b.name),
  );
}
export const isApplied = (entry: Entry) =>
  !!entry.applied ||
  ["已投递", "笔试", "一面", "二面", "终面", "Offer", "未通过"].includes(entry.status);
export function companySymbol(name: string) {
  const words = name.match(/[A-Za-z0-9]+/g);
  return words?.length
    ? words
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : name.slice(0, 2);
}
export function heatmapDays(year: number) {
  const start = new Date(Date.UTC(year, 0, 1)),
    end = new Date(Date.UTC(year, 11, 31));
  const offset = (start.getUTCDay() + 6) % 7,
    startTime = start.getTime() - offset * 86400000,
    days = [];
  for (let time = startTime; time <= end.getTime() || days.length % 7 !== 0; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    days.push({ date, inYear: date.startsWith(String(year)), future: date > today() });
  }
  return days;
}
/** Dated events for the schedule. A job's application deadline stops mattering once it has been applied to. */
export function timelineEvents(
  entries: Entry[],
  preferences: ReminderPreferences = defaultReminderPreferences,
) {
  return entries
    .flatMap((entry) => [
      ...[
        {
          date: entry.kind === "job" && isApplied(entry) ? "" : entry.deadline,
          label:
            entry.kind === "job" ? "投递截止" : entry.kind === "project" ? "项目目标" : "比赛截止",
          type: "deadline",
        },
        { date: entry.kind === "job" ? "" : entry.followUp, label: "跟进", type: "followup" },
        {
          date:
            typeof entry.extra["面试 / 测评时间"] === "string"
              ? entry.extra["面试 / 测评时间"].slice(0, 10)
              : "",
          label: "面试 / 测评",
          type: "interview",
        },
      ]
        .filter(
          (event) =>
            /^\d{4}-\d{2}-\d{2}$/.test(event.date) && !Number.isNaN(Date.parse(event.date)),
        )
        .map((event) => ({ ...event, id: entry.id + event.type, time: "", detail: "", entry })),
      ...(entry.appointments || [])
        .filter(
          (item) =>
            item.status === "scheduled" &&
            item.stageState === "current" &&
            item.response === "pending" &&
            stageDueDate(item, preferences.assessment.planDays),
        )
        .map((item) => ({
          id: entry.id + item.id,
          date: stageDueDate(item, preferences.assessment.planDays),
          time: item.type === "assessment" ? "" : appointmentTime(item.startsAt),
          label:
            item.type === "assessment"
              ? item.deadlineDate
                ? "笔试 / 测评截止"
                : "测评计划期限"
              : item.type === "interview"
                ? "面试"
                : "跟进",
          type: item.type,
          detail: item.title + (item.location ? " · " + item.location : ""),
          entry,
        })),
      ...recruitingReminders([entry], preferences).map((item) => ({
        id: item.id,
        date: item.date,
        time: "",
        label: item.source === "manual" ? "手动跟进" : "无反馈跟进",
        type: "followup",
        detail: item.title,
        entry,
      })),
    ])
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.time.localeCompare(b.time) ||
        a.entry.title.localeCompare(b.entry.title),
    );
}
