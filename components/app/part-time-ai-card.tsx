"use client";
import { useState } from "react";
import Link from "next/link";
import { Check, LoaderCircle } from "lucide-react";
import type { GigDraft } from "@/lib/ai-part-time";
import { formatMoney, gigTypes, type Income } from "@/lib/part-time-contract";
import { Button } from "@/components/ui/button";
import { Pill } from "./ui";

export type GigCard = GigDraft & { state?: "saved" | "superseded"; error?: string };
const names: Record<string, string> = { title: "名称", type: "类型", status: "状态", organization: "合作方 / 平台", url: "链接", dueDate: "下一步日期", nextAction: "下一步", compensation: "报酬 / 结算约定", notes: "备注" };
const display = (field: string, value: string) => field === "type" ? gigTypes[value as keyof typeof gigTypes] : value || "（清空）";
function Payment({ payment }: { payment: Income }) {
  return <><b className="tabular">{formatMoney(payment.amountMinor, payment.currency)}</b><span> · {payment.status === "received" ? "已到账" : "待到账"} · {payment.date}</span>{payment.period && <p>结算周期：{payment.period}</p>}{payment.note && <p className="whitespace-pre-wrap">{payment.note}</p>}</>;
}
export default function PartTimeAiCard({ card, busy, saving, onConfirm, onOpen }: { card: GigCard; busy: boolean; saving: boolean; onConfirm: (allowDuplicate: boolean) => void; onOpen: () => void }) {
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const done = !!card.state;
  const fields = card.operation === "add" ? Object.entries(names).map(([field]) => ({ field, before: "", after: String(card.item[field as keyof typeof card.item] ?? "") })).filter(c => c.after) : card.changes;
  return <article className={"w-full rounded-xl border bg-background p-3.5 " + (card.state === "superseded" ? "opacity-50" : "")}>
    <div className="flex items-center gap-2"><Pill tone={card.state === "saved" ? "green" : done ? "gray" : "violet"}>{card.state === "saved" ? "已保存" : done ? "已被新草稿替代" : card.operation === "add" ? "待确认新增兼职" : "待确认修改兼职"}</Pill><span className="ml-auto text-xs text-muted-foreground">{gigTypes[card.item.type]}</span></div>
    <h3 className="mt-2 text-sm font-semibold">{card.item.title}</h3>
    <dl className="mt-2 space-y-2 text-xs">{fields.map(change => <div key={change.field}><dt className="text-muted-foreground">{names[change.field]}</dt><dd className="mt-0.5 break-words whitespace-pre-wrap">{card.operation === "update" && <span className="text-muted-foreground">{display(change.field, change.before)} → </span>}{display(change.field, change.after)}</dd></div>)}</dl>
    {card.payments.map(p => <div key={p.payment.id} className="mt-3 rounded-lg border p-2.5 text-xs leading-relaxed"><p className="mb-1 font-medium">{p.operation === "add" ? "新增收入" : "修改收入"}</p>{p.before && <div className="mb-2 text-muted-foreground"><p>修改前</p><Payment payment={p.before} /></div>}<Payment payment={p.payment} /></div>)}
    {!card.payments.length && card.operation === "add" && <p className="mt-2 text-xs text-muted-foreground">仅建立兼职记录，尚未记入收入。</p>}
    {card.warnings.length > 0 && <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">{card.warnings.map(w => <p key={w}>{w}</p>)}{!done && <label className="mt-2 flex items-start gap-2"><input type="checkbox" disabled={busy} checked={allowDuplicate} onChange={e => setAllowDuplicate(e.target.checked)} />我已核对，仍要保存这份草稿</label>}</div>}
    {card.error && <p role="alert" className="mt-2 text-xs text-red-600">{card.error}</p>}
    {card.state === "saved" ? <Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href="/part-time" onClick={onOpen}><Check />查看兼职与收入</Link></Button> : !done && <><p className="mt-3 text-xs text-muted-foreground">核对后确认保存；需要调整可继续告诉 AI。</p><Button size="sm" className="mt-2 w-full" disabled={busy || (!!card.warnings.length && !allowDuplicate)} onClick={() => onConfirm(allowDuplicate)}>{saving ? <LoaderCircle className="animate-spin" /> : <Check />}{card.operation === "add" ? "确认添加兼职" : "确认保存修改"}</Button></>}
  </article>;
}
