import { z } from "zod";
import { agentActionSchema, prepareAgentActions, type AgentDraft, type AgentSnapshot } from "./agent-contract";
import { blankEntry, defaultJobDeadline, defaultNextAction, entrySchema, progressSchema, closed, type Entry, regions, workModes, employmentTypes, schedules, companyTypes, jobStatuses, competitionStatuses, projectStatuses } from "./model";
import { describeSchedule, reminderSchema, scheduleSchema, type Reminder } from "./reminder-schema";
import { blankWatch, watchSchema, type CompanyWatch } from "./watches";
import { channelSchema, companyProfileSchema } from "./journey";
import { gigProposalSchema, prepareGigDrafts, type GigDraft } from "./ai-part-time";
import type { Gig } from "./part-time-contract";

export const aiFilterSchema = z.object({
  label: z.string().max(200),
  kind: z.enum(["job", "competition", "project", "all"]).default("job"),
  keywords: z.array(z.string().min(1).max(100)).max(12).default([]),
  statuses: z.array(z.string().refine(s => [...jobStatuses, ...competitionStatuses, ...projectStatuses].includes(s))).max(20).default([]),
  region: z.string().refine(s => !s || regions.includes(s)).default(""),
  workMode: z.string().refine(s => !s || workModes.includes(s)).default(""),
  employmentType: z.string().refine(s => !s || employmentTypes.includes(s)).default(""),
  schedule: z.string().refine(s => !s || schedules.includes(s)).default(""),
  companyType: z.string().refine(s => !s || companyTypes.includes(s)).default(""),
  deadlineFrom: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default(""),
  deadlineTo: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).default(""),
  excludeClosed: z.boolean().default(false),
}).strict();
export type AiFilter = z.infer<typeof aiFilterSchema>;
export function matchesAiFilter(entry: Entry, filter: AiFilter) {
  const haystack = [entry.title, entry.organization, entry.location, entry.summary, entry.jd, entry.notes].join(" ").toLowerCase();
  return (filter.kind === "all" || entry.kind === filter.kind)
    && (!filter.keywords.length || filter.keywords.some(k => haystack.includes(k.toLowerCase())))
    && (!filter.statuses.length || filter.statuses.includes(entry.status))
    && (["region", "workMode", "employmentType", "schedule", "companyType"] as const).every(k => !filter[k] || entry[k] === filter[k])
    && (!filter.excludeClosed || !closed(entry))
    && (!filter.deadlineFrom || !!entry.deadline && entry.deadline >= filter.deadlineFrom)
    && (!filter.deadlineTo || !!entry.deadline && entry.deadline <= filter.deadlineTo);
}

/** Keep a page's record type boundary separate from the AI filter's scope. */
export function entriesForAiSurface(entries: Entry[], surface: "jobs" | "tracks", filter: AiFilter | null) {
  const allowed = surface === "jobs" ? new Set<Entry["kind"]>(["job"]) : new Set<Entry["kind"]>(["project", "competition"]);
  return entries.filter(entry => allowed.has(entry.kind) && (!filter || matchesAiFilter(entry, filter)));
}

export const aiEnrichmentSchema=z.object({scope:z.enum(["job","brand","all"]),target:z.object({kind:z.enum(["job","company","channel"]),id:z.string().min(1).max(2000)}).strict().nullable().default(null),force:z.boolean().default(false)}).strict();
export type AiEnrichment=z.infer<typeof aiEnrichmentSchema>;
const reminderProposal = z.object({
  operation: z.enum(["add", "update", "delete"]), targetId: z.string().max(100).optional(),
  title: z.string().max(300).optional(), note: z.string().max(4000).optional(), url: z.string().max(2000).optional(),
  schedule: scheduleSchema.optional(), entryId: z.string().max(100).nullable().optional(), active: z.boolean().optional(),
}).strict();
const profileProposal = z.object({
  targets: z.array(z.string().trim().min(1).max(60)).max(30).optional(), goals: z.string().max(10000).optional(),
  preferences: z.string().max(10000).optional(), background: z.string().max(20000).optional(),
}).strict();
const watchProposal = z.object({
  operation: z.enum(["add", "update"]), targetId: z.string().max(100).optional(), kind: z.enum(["company", "board"]).optional(),
  company: z.string().max(200).optional(), url: z.string().max(4000).optional(), keywords: z.string().max(2000).optional(), excludeKeywords: z.string().max(2000).optional(),
  regions: z.array(z.string()).optional(), employmentTypes: z.array(z.string()).optional(), workModes: z.array(z.string()).optional(), schedules: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
}).strict();
const directoryProposal = z.object({
  operation: z.literal("add"), kind: z.enum(["company", "channel"]), name: z.string().trim().min(1).max(2000),
  url: z.string().max(4000).default(""), logoUrl: z.string().max(4000).default(""),
}).strict();
export const aiReplySchema = z.object({
  reply: z.string().min(1).max(16000),
  actions: z.array(agentActionSchema).max(12).default([]),
  partTime: z.array(gigProposalSchema).max(8).default([]),
  drafts: z.array(z.object({
    operation: z.enum(["add", "update"]),
    targetId: z.string().max(100).optional(),
    fields: z.record(z.unknown()),
    progressLog: progressSchema.omit({id:true}).optional(),
    sourceImageIds: z.array(z.string().max(100)).max(6).default([]),
  }).strict()).max(8).default([]),
  enrichment:aiEnrichmentSchema.nullable().default(null),
  filter: aiFilterSchema.nullable().default(null),
  reminders: z.array(reminderProposal).max(6).default([]),
  profile: profileProposal.nullable().default(null),
  watches: z.array(watchProposal).max(6).default([]),
  directory: z.array(directoryProposal).max(12).default([]),
  scan: z.object({ watchIds: z.array(z.string().max(100)).max(50).nullable().default(null) }).strict().nullable().default(null),
  completeCompanies: z.object({ names: z.array(z.string().max(2000)).max(20).nullable().default(null), refreshLogo: z.boolean().default(false) }).strict().nullable().default(null),
}).strict();
export type AiDraft = {
  id: string; operation: "add" | "update"; entry: Entry; sourceImageIds: string[];
  duplicates: { id: string; title: string; organization: string }[]; changedFields: string[];
};
export type ReminderDraft = { id: string; operation: "add" | "update" | "delete"; reminder: Reminder; description: string };
export type WatchDraft = { id: string; operation: "add" | "update"; watch: CompanyWatch };
export type DirectoryDraft = { id: string; operation: "add"; kind: "company" | "channel"; name: string; url: string; logoUrl: string };
export type ProfileDraft = z.infer<typeof profileProposal>;
export type AiReply = { actions?: AgentDraft[]; reply: string; drafts: AiDraft[]; partTime: GigDraft[]; filter: AiFilter | null; matchCount: number | null; matchIds: string[] | null; model: string; enrichment:AiEnrichment|null;
  reminders: ReminderDraft[]; profile: ProfileDraft | null; watches: WatchDraft[]; directory: DirectoryDraft[]; scan: { watchIds: string[] | null; label: string } | null; completeCompanies: { names: string[] | null; refreshLogo: boolean } | null; pages: { url: string; title: string; ok: boolean; note: string; source?: "link" | "tavily" }[] };
export type AiContext = { reminders: Reminder[]; watches: CompanyWatch[]; gigs?: Gig[]; agent?: AgentSnapshot };
const editable = new Set(Object.keys(blankEntry("job")).filter(k => !["id", "revision", "extra", "jdSavedAt", "jdStatus", "progress", "appointments", "fit", "career", "outlook"].includes(k)));
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function prepareAiReply(raw: unknown, entries: Entry[], imageIds: string[], model: string, context: AiContext = { reminders: [], watches: [] }): Omit<AiReply, "pages"> {
  const parsed = aiReplySchema.parse(raw);
  const drafts = parsed.drafts.map(draft => {
    const old = draft.operation === "update" ? entries.find(e => e.id === draft.targetId) : undefined;
    if (draft.operation === "update" && !old) throw Error("AI 提议修改的记录不存在，请重新说明目标。");
    const fields = Object.fromEntries(Object.entries(draft.fields).filter(([k]) => editable.has(k)));
    const base = old || blankEntry(fields.kind === "competition" || fields.kind === "project" ? fields.kind : "job");
    const candidate={ ...base, ...fields, id: base.id, revision: base.revision,
      progress: draft.progressLog ? [...base.progress, {...draft.progressLog,id:crypto.randomUUID()}] : base.progress,
      jdStatus: fields.jd !== undefined && fields.jd !== base.jd ? (fields.jd ? "partial" : "missing") : base.jdStatus };
    if(!old&&candidate.kind==="job") { if(!candidate.deadline)candidate.deadline=defaultJobDeadline(candidate);if(!candidate.nextAction)candidate.nextAction=defaultNextAction(candidate.status); }
    const entry = entrySchema.parse(candidate);
    if (entry.summary && entry.jdStatus === "missing") entry.jdStatus = "partial";
    if(draft.progressLog&&entry.kind==="job")throw Error("进度只能添加到项目或比赛记录");
    const sourceImageIds = draft.sourceImageIds.filter(id => imageIds.includes(id));
    const duplicates = entries.filter(e => e.id !== entry.id && e.kind === entry.kind &&
      ((!!entry.url && e.url === entry.url) || (normalize(e.organization) === normalize(entry.organization) && normalize(e.title) === normalize(entry.title))))
      .map(({ id, title, organization }) => ({ id, title, organization }));
    return { id: crypto.randomUUID(), operation: draft.operation, entry, sourceImageIds, duplicates,
      changedFields: [...Object.keys(fields).filter(k => JSON.stringify(entry[k as keyof Entry]) !== JSON.stringify(base[k as keyof Entry])),...(draft.progressLog?["progress"]:[])] };
  });
  if(parsed.enrichment?.target?.kind==="job"&&!entries.some(e=>e.kind==="job"&&e.id===parsed.enrichment!.target!.id))throw Error("请指定已有岗位进行评估");
  // Reminders: new ones get an id; updates and deletes must name an existing reminder.
  const reminders = parsed.reminders.map((p): ReminderDraft => {
    const old = p.operation === "add" ? undefined : context.reminders.find(r => r.id === p.targetId);
    if (p.operation !== "add" && !old) throw Error("AI 提到的提醒不存在，请重新说明。");
    const reminder = reminderSchema.parse({ ...(old ?? { id: crypto.randomUUID(), note: "", url: "", active: true, entryId: null, source: "ai", revision: 0 }),
      ...Object.fromEntries(Object.entries(p).filter(([k, v]) => !["operation", "targetId"].includes(k) && v !== undefined)),
      ...(p.entryId && !entries.some(e => e.id === p.entryId) ? { entryId: null } : {}) });
    return { id: crypto.randomUUID(), operation: p.operation, reminder, description: describeSchedule(reminder.schedule) };
  });
  const watches = parsed.watches.map((p): WatchDraft => {
    const old = p.operation === "update" ? context.watches.find(w => w.id === p.targetId) : undefined;
    if (p.operation === "update" && !old) throw Error("AI 提到的关注项不存在，请重新说明。");
    const clean = <T extends string>(values: T[] | undefined, allowed: string[]) => values?.filter(v => allowed.includes(v));
    const watch = watchSchema.parse({ ...(old ?? blankWatch(p.kind ?? "company")), ...Object.fromEntries(Object.entries({ ...p,
      regions: clean(p.regions, regions), employmentTypes: clean(p.employmentTypes, employmentTypes), workModes: clean(p.workModes, workModes), schedules: clean(p.schedules, schedules),
    }).filter(([k, v]) => !["operation", "targetId"].includes(k) && v !== undefined)) });
    return { id: crypto.randomUUID(), operation: p.operation, watch };
  });
  const directory = parsed.directory.map((p): DirectoryDraft => {
    if (p.kind === "company") {
      const item = companyProfileSchema.parse({ name: p.name, website: p.url, logoUrl: p.logoUrl });
      return { id: crypto.randomUUID(), operation: p.operation, kind: p.kind, name: item.name, url: item.website, logoUrl: item.logoUrl };
    }
    const item = channelSchema.parse({ name: p.name, url: p.url, logoUrl: p.logoUrl });
    return { id: crypto.randomUUID(), operation: p.operation, kind: p.kind, name: item.name, url: item.url, logoUrl: item.logoUrl };
  });
  const scanIds = parsed.scan?.watchIds?.filter(id => context.watches.some(w => w.id === id)) ?? null;
  const matched = parsed.filter ? entries.filter(e => matchesAiFilter(e, parsed.filter!)) : null;
  if (parsed.actions.length && !context.agent) throw Error("AI 完整操作上下文不可用，请重试。");
  return { actions: context.agent ? prepareAgentActions(parsed.actions, context.agent) : [], enrichment:parsed.enrichment,reply: parsed.reply, drafts, partTime: prepareGigDrafts(parsed.partTime, context.gigs ?? []), filter: parsed.filter,
    matchCount: matched?.length ?? null, matchIds: matched?.map(e => e.id) ?? null, model,
    reminders, profile: parsed.profile && Object.keys(parsed.profile).length ? parsed.profile : null, watches, directory,
    scan: parsed.scan ? { watchIds: scanIds?.length ? scanIds : null, label: scanIds?.length ? context.watches.filter(w => scanIds.includes(w.id)).map(w => w.company).join("、") : "全部已开启的关注" } : null,
    completeCompanies: parsed.completeCompanies };
}

export const aiImageSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), name: z.string().max(200), dataUrl: z.string().max(1600000) }).strict();
export const aiRequestSchema = z.object({
  runId: z.string().uuid().optional(),
  workspace: z.enum(["desk", "part-time"]).optional(),
  page: z.enum(["/", "/jobs", "/competitions", "/projects", "/part-time", "/companies", "/schedule", "/insights", "/settings"]).optional(),
  selectedEntryId: z.string().max(100).nullable().optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(36000) }).strict()).min(1).max(18),
  images: z.array(aiImageSchema).max(6).default([]),
  currentFilter: aiFilterSchema.nullable().optional(),
}).strict().refine(v => v.messages.at(-1)?.role === "user", "最后一条必须是用户消息");

export function validImageData(value: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const data = Buffer.from(match[2], "base64");
  if (data.length > 1200000 || data.length < 12) return false;
  return match[1] === "png" ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === "jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : data.toString("ascii",0,4) === "RIFF" && data.toString("ascii",8,12) === "WEBP";
}
