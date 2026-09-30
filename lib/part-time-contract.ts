import { z } from "zod";
import { today } from "./model";

export const gigTypes = { task: "一次性任务", ongoing: "长期兼职", income: "平台收入" } as const;
export const gigStatuses = ["待开始", "进行中", "已完成", "暂停", "已放弃"] as const;
export const currencies = ["HKD", "USD", "CNY", "SGD", "EUR", "GBP", "JPY"] as const;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const date = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value, "请填写有效日期");
export const incomeSchema = z.object({
  id, amountMinor: z.number().int().positive().max(100_000_000_000),
  currency: z.enum(currencies), status: z.enum(["pending", "received"]), date,
  period: z.string().trim().max(100).default(""), note: z.string().max(2000).default(""),
  voided: z.boolean().default(false),
}).strict().refine(value => value.status !== "received" || value.date <= today(), "到账日期不能晚于今天")
  .refine(value => value.currency !== "JPY" || value.amountMinor % 100 === 0, "日元金额请填写整数");
export const gigSchema = z.object({
  id, title: z.string().trim().min(1,"请填写名称").max(300),
  type: z.enum(["task", "ongoing", "income"]), status: z.enum(gigStatuses),
  organization: z.string().trim().max(300).default(""),
  url: z.string().max(4000).refine(value => !value || /^https?:\/\//i.test(value) && URL.canParse(value), "请填写有效的网页链接").default(""),
  dueDate: z.union([z.literal(""), date]).default(""), nextAction: z.string().max(2000).default(""),
  compensation: z.string().max(2000).default(""), notes: z.string().max(20000).default(""),
  archived: z.boolean().default(false), revision: z.number().int().min(0).default(0),
  payments: z.array(incomeSchema).max(2000).default([]).refine(items => new Set(items.map(item => item.id)).size === items.length, "收入记录 ID 不能重复"),
}).strict();
export type Gig = z.infer<typeof gigSchema>;
export type Income = z.infer<typeof incomeSchema>;
export function newGig(type: Gig["type"] = "task"): Gig {
  return { id: crypto.randomUUID(), title: "", type, status: "待开始", organization: "", url: "", dueDate: "", nextAction: "", compensation: "", notes: "", archived: false, revision: 0, payments: [] };
}
export function parseAmount(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) throw Error("金额请填写大于 0 的数字，最多两位小数");
  const [whole, fraction = ""] = value.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 100_000_000_000) throw Error("金额超出允许范围");
  return minor;
}
export const formatMoney = (minor: number, currency: Income["currency"]) => new Intl.NumberFormat("zh-CN", { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: currency === "JPY" ? 0 : 2 }).format(minor / 100);
export function incomeTotals(items: Gig[], month = today().slice(0,7)) {
  const totals = new Map<Income["currency"], { currency: Income["currency"]; received: number; month: number; pending: number }>();
  for (const item of items) for (const payment of item.payments) {
    if (payment.voided) continue;
    const total = totals.get(payment.currency) ?? { currency: payment.currency, received: 0, month: 0, pending: 0 };
    if (payment.status === "pending") total.pending += payment.amountMinor;
    else { total.received += payment.amountMinor; if (payment.date.startsWith(month + "-")) total.month += payment.amountMinor; }
    totals.set(payment.currency, total);
  }
  return [...totals.values()].sort((a,b) => a.currency.localeCompare(b.currency));
}
