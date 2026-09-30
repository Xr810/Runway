import { z } from "zod";
import { currencies, formatMoney, gigSchema, incomeSchema, newGig, parseAmount, type Gig, type Income } from "./part-time-contract";

const fieldsSchema = gigSchema.pick({ title: true, type: true, status: true, organization: true, url: true, dueDate: true, nextAction: true, compensation: true, notes: true }).partial().strict();
const paymentFields = z.object({
  amount: z.string().max(30), currency: z.enum(currencies), status: z.enum(["pending", "received"]),
  date: z.string().max(10), period: z.string().max(100).optional(), note: z.string().max(2000).optional(),
}).strict();
const paymentProposal = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("add"), fields: paymentFields }).strict(),
  z.object({ operation: z.literal("update"), targetId: z.string().min(1).max(100), fields: paymentFields.partial() }).strict(),
]);
export const gigProposalSchema = z.object({
  operation: z.enum(["add", "update"]), targetId: z.string().max(100).optional(),
  fields: fieldsSchema.default({}), payments: z.array(paymentProposal).max(8).default([]),
}).strict();
export type GigDraft = {
  id: string; operation: "add" | "update"; item: Gig;
  changes: { field: string; before: string; after: string }[];
  payments: { operation: "add" | "update"; before?: Income; payment: Income }[];
  warnings: string[];
};
const normalize = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export function gigDraftWarnings(draft: GigDraft, items: Gig[]) {
  const warnings: string[] = [];
  if (draft.operation === "add") for (const item of items) {
    if (item.id !== draft.item.id && ((draft.item.url && item.url === draft.item.url) || normalize(item.title) === normalize(draft.item.title))) warnings.push(`可能重复的兼职：${item.title}${item.archived ? "（已归档）" : ""}`);
  }
  const oldPayments = items.find(item => item.id === draft.item.id)?.payments ?? [];
  for (const { payment } of draft.payments) {
    if ([...oldPayments, ...draft.payments.map(p => p.payment)].some(p => !p.voided && p.id !== payment.id && p.amountMinor === payment.amountMinor && p.currency === payment.currency && p.date === payment.date && p.period === payment.period)) {
      warnings.push(`可能重复的收入：${formatMoney(payment.amountMinor, payment.currency)} · ${payment.date}${payment.period ? " · " + payment.period : ""}，请核对是否应更新已有收款。`);
    }
  }
  return [...new Set(warnings)];
}

export function prepareGigDrafts(proposals: z.infer<typeof gigProposalSchema>[], items: Gig[]): GigDraft[] {
  const targets = new Set<string>();
  const drafts = proposals.map((proposal): GigDraft => {
    const old = proposal.operation === "update" ? items.find(item => item.id === proposal.targetId) : undefined;
    if (proposal.operation === "update" && !old) throw Error("AI 提到的兼职不存在，请明确要修改哪条记录。");
    if (old?.archived) throw Error("AI 提到的兼职已归档，请先在兼职页面恢复。");
    if (old && targets.has(old.id)) throw Error("AI 对同一兼职提出了多份修改，请合并后重试。");
    if (old) targets.add(old.id);
    const base = old ?? newGig(proposal.fields.type ?? "task");
    const touched = new Set<string>();
    const payments = proposal.payments.map(p => {
      const before = p.operation === "update" ? base.payments.find(income => income.id === p.targetId) : undefined;
      if (p.operation === "update" && (!before || before.voided)) throw Error("AI 提到的收入不存在或已作废，请核对后重试。");
      if (before && touched.has(before.id)) throw Error("AI 对同一笔收入提出了重复修改，请重试。");
      if (before) touched.add(before.id);
      const { amount, ...fields } = p.fields;
      const payment = incomeSchema.parse({ ...before, ...fields, id: before?.id ?? crypto.randomUUID(), voided: false,
        amountMinor: amount === undefined ? before?.amountMinor : parseAmount(amount) });
      return { operation: p.operation, before, payment };
    });
    const item = gigSchema.parse({ ...base, ...proposal.fields, payments: [
      ...base.payments.map(p => payments.find(change => change.operation === "update" && change.payment.id === p.id)?.payment ?? p),
      ...payments.filter(p => p.operation === "add").map(p => p.payment),
    ] });
    return { id: crypto.randomUUID(), operation: proposal.operation, item, payments, warnings: [],
      changes: Object.keys(proposal.fields).filter(k => item[k as keyof Gig] !== base[k as keyof Gig]).map(field => ({ field, before: String(base[field as keyof Gig]), after: String(item[field as keyof Gig]) })) };
  });
  return drafts.map(draft => ({ ...draft, warnings: gigDraftWarnings(draft, [...items, ...drafts.filter(other => other.id !== draft.id).map(other => other.item)]) }));
}

/** Recover a lost save response using the stable draft IDs, without applying stale changes. */
export function gigDraftAlreadySaved(draft: GigDraft, items: Gig[]) {
  const existing = items.find(item => item.id === draft.item.id);
  // PostgreSQL jsonb reorders object keys, so normalize both sides before comparing.
  if (existing && existing.revision > draft.item.revision && JSON.stringify({ ...gigSchema.parse(existing), revision: 0 }) === JSON.stringify({ ...gigSchema.parse(draft.item), revision: 0 })) return true;
  if (draft.operation === "update" && !existing || existing && existing.revision !== draft.item.revision) throw Error("兼职记录已变化，请重新告诉 AI 你的修改，生成最新草稿。");
  return false;
}
