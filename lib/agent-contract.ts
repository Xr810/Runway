import { z } from "zod";
import {
  entryObject,
  entryAgentFieldSchema,
  entrySchema,
  blankEntry,
  defaultJobDeadline,
  defaultNextAction,
  withStatusNextAction,
  today,
  type Entry,
} from "./model";
import { appointmentSchema, normalizeStageStates } from "./appointments";
import { progressSchema } from "./model";
import {
  companyProfileSchema,
  channelSchema,
  directorySchema,
  identity,
  type Directory,
} from "./journey";
import { gigSchema, incomeSchema, newGig, type Gig } from "./part-time-contract";
import { watchSchema, blankWatch, type CompanyWatch } from "./watches";
import { reminderSchema, type Reminder } from "./reminder-schema";
import { profileSchema, targetSchema, type EvaluationProfile } from "./enrichment-contract";
import type { AgentCommand, AgentDestination } from "./agent-commands";
import {
  parseAgentOperation,
  scanFields,
  type AgentOperation,
  type AgentPayloads,
} from "./agent-payload";
export { scanFields } from "./agent-payload";

const id = z.string().min(1).max(2000);
const fields = z.record(z.unknown());
export const agentActionSchema = z.discriminatedUnion("module", [
  z
    .object({
      module: z.literal("entry"),
      operation: z.enum(["add", "update", "delete", "restore"]),
      targetId: id.optional(),
      sourceImageIds: z.array(id).max(6).default([]),
      fields: fields.default({}),
    })
    .strict(),
  z
    .object({
      module: z.enum(["appointment", "progress"]),
      operation: z.enum(["add", "update", "delete"]),
      targetId: id,
      itemId: id.optional(),
      fields: fields.default({}),
    })
    .strict(),
  z
    .object({
      module: z.enum(["company", "channel"]),
      operation: z.enum(["add", "update", "delete"]),
      targetId: id.optional(),
      fields: fields.default({}),
    })
    .strict(),
  z
    .object({
      module: z.literal("gig"),
      operation: z.enum(["add", "update"]),
      targetId: id.optional(),
      fields,
      payments: z
        .array(incomeSchema.innerType().innerType().omit({ id: true, voided: true }))
        .max(8)
        .default([]),
    })
    .strict(),
  z
    .object({
      module: z.literal("payment"),
      operation: z.enum(["add", "update", "void", "restore"]),
      targetId: id,
      itemId: id.optional(),
      fields: fields.default({}),
    })
    .strict(),
  z
    .object({
      module: z.literal("watch"),
      operation: z.enum(["add", "update", "delete"]),
      targetId: id.optional(),
      fields: fields.default({}),
    })
    .strict(),
  z
    .object({
      module: z.literal("reminder"),
      operation: z.enum(["add", "update", "delete", "done"]),
      targetId: id.optional(),
      fields,
    })
    .strict(),
  z.object({ module: z.literal("profile"), operation: z.literal("update"), fields }).strict(),
  z.object({ module: z.literal("scanSettings"), operation: z.literal("update"), fields }).strict(),
  z
    .object({
      module: z.literal("model"),
      operation: z.literal("update"),
      fields: z.object({ model: z.string().trim().min(1).max(250) }).strict(),
    })
    .strict(),
  z
    .object({
      module: z.literal("notifications"),
      operation: z.enum(["read", "dismiss"]),
      ids: z.array(z.string().uuid()).min(1).max(100),
    })
    .strict(),
  z
    .object({
      module: z.literal("evaluation"),
      operation: z.literal("lock"),
      target: targetSchema,
      locked: z.boolean(),
    })
    .strict(),
  z
    .object({
      module: z.literal("scan"),
      operation: z.literal("run"),
      watchIds: z.array(id).min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      module: z.literal("companyCompletion"),
      operation: z.literal("run"),
      names: z.array(id).min(1).max(50).optional(),
      refreshLogo: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      module: z.literal("assessment"),
      operation: z.literal("run"),
      scope: z.enum(["job", "brand", "all"]),
      target: targetSchema.optional(),
      force: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      module: z.literal("version"),
      operation: z.literal("restore"),
      targetId: id,
      itemId: id,
    })
    .strict(),
  z.object({ module: z.literal("brief"), operation: z.literal("refresh") }).strict(),
  z.object({ module: z.literal("jdSummary"), operation: z.literal("run"), targetId: id }).strict(),
]);
export type AgentAction = z.infer<typeof agentActionSchema>;
export type AgentDraft = AgentDestination & {
  id: string;
  title: string;
  body: unknown;
  changes: { field: string; before: unknown; after: unknown }[];
  sourceImageIds?: string[];
  warnings?: string[];
};
/** New proposals are typed; old persisted drafts remain unknown until execution. */
export function createAgentDraft<C extends AgentCommand>(
  title: string,
  command: C,
  body: AgentPayloads[NoInfer<C>],
  changes: AgentDraft["changes"] = [],
): AgentOperation & Pick<AgentDraft, "id" | "title" | "changes"> {
  return { id: crypto.randomUUID(), title, ...parseAgentOperation(command, body), changes };
}
export type AgentSnapshot = {
  entries: Entry[];
  deleted: Entry[];
  directory: Directory;
  gigs: Gig[];
  watches: CompanyWatch[];
  reminders: Reminder[];
  profile: EvaluationProfile;
  scanSettings: { enabled: boolean; time: string; maxAddPerWatch: number };
  ai: { base: string; model: string; revision: number };
  versions?: { id: string; entry_id: string; data: string }[];
};
export const entryAgentFields = entryAgentFieldSchema;
function requireItem<T>(item: T | undefined): T {
  if (!item) throw Error("AI 指定的记录不存在，请重新选择目标。");
  return item;
}
export function changes(before: object, after: object, keys: string[]) {
  const a = before as Record<string, unknown>,
    b = after as Record<string, unknown>;
  return keys
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((field) => ({ field, before: a[field] ?? null, after: b[field] ?? null }));
}
/** Compile model intentions to domain commands. The model never chooses a command or revision directly. */
export function prepareAgentActions(raw: unknown[], s: AgentSnapshot): AgentDraft[] {
  const touched = new Set<string>();
  return raw.map((value) => {
    const a = agentActionSchema.parse(value);
    const key = [
      a.module === "appointment" || a.module === "progress"
        ? "entry"
        : a.module === "payment"
          ? "gig"
          : a.module === "company" || a.module === "channel"
            ? "directory"
            : a.module,
      "operation" in a &&
      a.operation === "add" &&
      !["company", "channel", "payment", "appointment", "progress"].includes(a.module)
        ? crypto.randomUUID()
        : "targetId" in a && !["company", "channel"].includes(a.module)
          ? a.targetId
          : "",
    ].join(":");
    if (touched.has(key)) throw Error("AI 对同一记录提出了多份操作，请合并修改或分次确认。");
    touched.add(key);
    const draft = createAgentDraft;
    if (a.module === "entry") {
      if (a.operation === "add") {
        const patch = entryAgentFields.parse(a.fields);
        const candidate = { ...blankEntry(patch.kind ?? "job"), ...patch };
        if (candidate.kind === "job") {
          if (!candidate.deadline) candidate.deadline = defaultJobDeadline(candidate);
          if (!candidate.nextAction) candidate.nextAction = defaultNextAction(candidate.status);
        }
        const next = entrySchema.parse(candidate);
        const duplicates = s.entries.filter(
          (e) =>
            e.kind === next.kind &&
            ((next.url && next.url === e.url) ||
              (identity(e.title) === identity(next.title) &&
                identity(e.organization) === identity(next.organization))),
        );
        return {
          ...draft(
            "新增：" + next.title,
            "entries",
            { action: "save", entry: next },
            changes({}, next, Object.keys(patch)),
          ),
          sourceImageIds: a.sourceImageIds,
          warnings: duplicates.map((e) => "可能重复：" + e.title),
        };
      }
      const old = requireItem(
        (a.operation === "restore" ? s.deleted : s.entries).find((e) => e.id === a.targetId),
      );
      if (a.operation !== "update")
        return draft(
          (a.operation === "delete" ? "移至回收站：" : "恢复：") + old.title,
          "entries",
          {
            action: a.operation === "delete" ? "delete" : "undelete",
            id: old.id,
            revision: old.revision,
          },
        );
      const patch = entryAgentFields.parse(a.fields);
      const effective = withStatusNextAction(old.kind, patch);
      const next = entrySchema.parse({ ...old, ...effective });
      return {
        ...draft(
          "修改：" + old.title,
          "entries",
          { action: "save", entry: next },
          changes(old, next, Object.keys(effective)),
        ),
        sourceImageIds: a.sourceImageIds,
      };
    }
    if (a.module === "appointment" || a.module === "progress") {
      const old = requireItem(s.entries.find((e) => e.id === a.targetId));
      if (a.module === "progress" && old.kind === "job")
        throw Error("AI 岗位请使用面试日程，项目或比赛使用进度。");
      const field = a.module === "appointment" ? "appointments" : "progress",
        schema = a.module === "appointment" ? appointmentSchema : progressSchema;
      const items = old[field];
      const previous =
        a.operation === "add" ? undefined : requireItem(items.find((p) => p.id === a.itemId));
      if ("id" in a.fields) throw Error("AI 不能改写日程或进度的 ID。");
      const item =
        a.operation === "delete"
          ? null
          : schema.parse({ ...previous, ...a.fields, id: previous?.id ?? crypto.randomUUID() });
      const updated =
        a.operation === "add"
          ? [...items, item!]
          : items.flatMap((p) => (p.id === previous!.id ? (item ? [item] : []) : [p]));
      const next = entrySchema.parse({
        ...old,
        [field]:
          a.module === "appointment"
            ? normalizeStageStates(updated as typeof old.appointments)
            : updated,
      });
      return draft(
        (a.module === "appointment" ? "日程：" : "进度：") + old.title,
        "entries",
        { action: "save", entry: next },
        changes(old, next, [field]),
      );
    }
    if (a.module === "company" || a.module === "channel") {
      const field = a.module === "company" ? "companies" : "channels",
        schema = a.module === "company" ? companyProfileSchema : channelSchema;
      const old =
        a.operation === "add"
          ? undefined
          : requireItem(
              s.directory[field].find((p) => identity(p.name) === identity(a.targetId ?? "")),
            );
      const patch = schema.partial().strict().parse(a.fields);
      const item = a.operation === "delete" ? null : schema.parse({ ...old, ...patch });
      const next = directorySchema.parse({
        ...s.directory,
        [field]:
          a.operation === "add"
            ? [...s.directory[field], item]
            : s.directory[field].flatMap((p) => (p === old ? (item ? [item] : []) : [p])),
      });
      if (new Set(next[field].map((p) => identity(p.name))).size !== next[field].length)
        throw Error("AI 公司或渠道名称重复。");
      return draft(
        { add: "新增", update: "修改", delete: "删除" }[a.operation] +
          (a.module === "company" ? "公司：" : "渠道：") +
          (old?.name ?? item!.name),
        "directory",
        { action: "save", directory: next },
        changes({ item: old ?? null }, { item }, ["item"]),
      );
    }
    if (a.module === "gig" || a.module === "payment") {
      const old =
        a.module === "gig" && a.operation === "add"
          ? newGig()
          : requireItem(s.gigs.find((g) => g.id === a.targetId));
      let next: Gig;
      if (a.module === "gig")
        next = gigSchema.parse({
          ...old,
          ...gigSchema
            .omit({ id: true, revision: true, payments: true })
            .partial()
            .strict()
            .parse(a.fields),
          payments: [
            ...old.payments,
            ...a.payments.map((p) => ({ ...p, id: crypto.randomUUID(), voided: false })),
          ],
        });
      else {
        const payment =
          a.operation === "add"
            ? { id: crypto.randomUUID(), voided: false }
            : requireItem(old.payments.find((p) => p.id === a.itemId));
        const allowed = ["amountMinor", "currency", "status", "date", "period", "note"];
        if (Object.keys(a.fields).some((k) => !allowed.includes(k)))
          throw Error("AI 收入字段无效。");
        const item = incomeSchema.parse({
          ...payment,
          ...a.fields,
          voided:
            a.operation === "void" ? true : a.operation === "restore" ? false : payment.voided,
        });
        next = gigSchema.parse({
          ...old,
          payments:
            a.operation === "add"
              ? [...old.payments, item]
              : old.payments.map((p) => (p.id === item.id ? item : p)),
        });
      }
      const warnings: string[] = [];
      if (
        !old.revision &&
        s.gigs.some(
          (g) => identity(g.title) === identity(next.title) || (next.url && next.url === g.url),
        )
      )
        warnings.push("可能存在同名或相同链接的兼职，请核对。");
      const added = next.payments.filter((p) => !old.payments.some((o) => o.id === p.id));
      if (
        added.some((p) =>
          next.payments.some(
            (o) =>
              o.id !== p.id &&
              !o.voided &&
              o.amountMinor === p.amountMinor &&
              o.currency === p.currency &&
              o.date === p.date &&
              o.period === p.period,
          ),
        )
      )
        warnings.push("可能存在相同金额、币种和日期的收入，请核对。");
      return {
        ...draft(
          (old.revision ? "修改兼职：" : "新增兼职：") + next.title,
          "gigs",
          next,
          changes(
            old,
            next,
            a.module === "gig"
              ? [...Object.keys(a.fields), ...(a.payments.length ? ["payments"] : [])]
              : ["payments"],
          ),
        ),
        warnings,
      };
    }
    if (a.module === "watch") {
      const old =
        a.operation === "add"
          ? blankWatch()
          : requireItem(s.watches.find((w) => w.id === a.targetId));
      const next = watchSchema.parse({
        ...old,
        ...watchSchema.omit({ id: true, revision: true }).partial().strict().parse(a.fields),
      });
      return draft(
        (a.operation === "delete" ? "删除关注：" : "修改关注：") + old.company,
        "watches",
        { action: a.operation === "delete" ? "delete" : "save", watch: next },
        changes(old, next, Object.keys(a.fields)),
      );
    }
    if (a.module === "reminder") {
      if (a.operation === "add") {
        const patch = reminderSchema
          .omit({ id: true, revision: true })
          .partial()
          .strict()
          .parse(a.fields);
        const next = reminderSchema.parse({
          ...patch,
          id: crypto.randomUUID(),
          revision: 0,
          source: "ai",
        });
        return draft(
          "新增提醒：" + next.title,
          "reminders",
          { action: "save", reminder: next },
          changes({}, next, Object.keys(a.fields)),
        );
      }
      const old = requireItem(s.reminders.find((r) => r.id === a.targetId));
      if (a.operation === "delete")
        return draft(
          "删除提醒：" + old.title,
          "reminders",
          { action: "delete", id: old.id, revision: old.revision },
          [{ field: "title", before: old.title, after: null }],
        );
      if (a.operation === "done") {
        const p = z
          .object({ day: z.string().date().default(today()), done: z.boolean() })
          .strict()
          .parse(a.fields);
        return draft(
          "提醒完成状态：" + old.title,
          "reminders",
          { action: "done", id: old.id, revision: old.revision, ...p },
          changes({}, p, Object.keys(p)),
        );
      }
      const patch = reminderSchema
        .omit({ id: true, revision: true })
        .partial()
        .strict()
        .parse(a.fields);
      const next = reminderSchema.parse({ ...old, ...patch });
      return draft(
        "修改提醒：" + old.title,
        "reminders",
        { action: "save", reminder: next },
        changes(old, next, Object.keys(patch)),
      );
    }
    if (a.module === "profile") {
      const patch = profileSchema
        .omit({ revision: true, cv: true })
        .partial()
        .strict()
        .parse(a.fields);
      return draft(
        "更新个人背景与简历文字",
        "profile",
        { action: "profile", profile: { ...s.profile, ...patch } },
        changes(s.profile, patch, Object.keys(patch)),
      );
    }
    if (a.module === "scanSettings") {
      const patch = scanFields.partial().parse(a.fields),
        settings = scanFields.parse({ ...s.scanSettings, ...patch });
      return draft(
        "更新自动扫描设置",
        "scanSettings",
        { action: "settings", settings, before: s.scanSettings },
        changes(s.scanSettings, settings, Object.keys(patch)),
      );
    }
    if (a.module === "model")
      return draft(
        "切换内置模型",
        "model",
        { action: "save", ...s.ai, model: a.fields.model },
        changes(s.ai, a.fields, ["model"]),
      );
    if (a.module === "notifications")
      return draft(
        a.operation === "read" ? "标为已读" : "收起通知",
        "notifications",
        { action: a.operation, ids: a.ids },
        [{ field: "通知 ID", before: a.ids, after: a.operation }],
      );
    if (a.module === "evaluation")
      return draft((a.locked ? "锁定" : "解锁") + "评估 / 图标：" + a.target.id, "evaluation", {
        action: "lock",
        target: a.target,
        locked: a.locked,
      });
    if (a.module === "scan") {
      if (a.watchIds?.some((id) => !s.watches.some((w) => w.id === id)))
        throw Error("AI 指定的关注不存在，不能扩大到全部。");
      return draft("扫描招聘关注", "scan", { action: "run", watchIds: a.watchIds }, [
        { field: "范围", before: null, after: a.watchIds ?? "全部已开启关注" },
      ]);
    }
    if (a.module === "companyCompletion")
      return draft(
        "补全公司资料",
        "companyCompletion",
        { names: a.names, refreshLogo: a.refreshLogo },
        [
          { field: "范围", before: null, after: a.names ?? "全部缺失资料的公司" },
          { field: "重新获取图标", before: null, after: a.refreshLogo },
        ],
      );
    if (a.module === "assessment")
      return draft(
        "运行内置评估",
        "assessment",
        { action: "run", scope: a.scope, target: a.target, force: a.force },
        [
          { field: "范围", before: null, after: a.target ?? a.scope },
          { field: "强制重评", before: false, after: a.force },
        ],
      );
    if (a.module === "version") {
      const old = requireItem(s.entries.find((e) => e.id === a.targetId));
      const version = requireItem(
        s.versions?.find((v) => v.id === a.itemId && v.entry_id === old.id),
      );
      const historical = z
        .object({
          jd: z.string(),
          jdStatus: entryObject.shape.jdStatus,
          summary: z.string(),
          url: z.string(),
        })
        .parse(JSON.parse(version.data));
      const next = entrySchema.parse({ ...old, ...historical });
      return draft(
        "恢复历史正文：" + old.title,
        "entries",
        { action: "save", entry: next },
        changes(old, next, Object.keys(historical)),
      );
    }
    if (a.module === "brief") return draft("刷新今日简报", "brief", {});
    if (a.module === "jdSummary") {
      const entry = requireItem(s.entries.find((e) => e.id === a.targetId && e.kind === "job"));
      if (!entry.jd.trim()) throw Error("请先保存 JD 原文，再整理摘要。");
      return draft("整理 JD 摘要：" + entry.title, "jdSummary", { entryId: entry.id });
    }
    const unhandled: never = a.module;
    throw Error(`未实现的 AI 操作：${JSON.stringify(unhandled)}`);
  });
}

export const agentReadSchema = z
  .object({
    module: z.enum([
      "entries",
      "deleted",
      "directory",
      "gigs",
      "watches",
      "reminders",
      "profile",
      "settings",
      "notifications",
      "evaluations",
      "versions",
      "files",
      "brief",
      "scan",
      "companyCompletion",
      "capabilities",
    ]),
    kind: z.enum(["job", "company", "channel"]).optional(),
    before: z.string().regex(/^\d+$/).optional(),
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    id: z.string().max(2000).optional(),
    query: z.string().max(200).optional(),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export type AgentRead = z.infer<typeof agentReadSchema>;
