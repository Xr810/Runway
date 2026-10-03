"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Archive, ArrowDownToLine, Check, ClipboardList, ExternalLink, LoaderCircle, Pencil, Plus, Search, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { today } from "@/lib/model";
import { currencies, formatMoney, gigSchema, gigStatuses, gigTypes, incomeSchema, incomeTotals, newGig, parseAmount, type Gig, type Income } from "@/lib/part-time-contract";
import { readJson } from "@/lib/api-response";
import { cn } from "@/lib/utils";
import { EmptyState, PageHeader, Pill, Segmented } from "../ui";
import { useDesk } from "../store";

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50";
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1.5 text-sm"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}
type PaymentDraft = { item: Gig; payment: Income; amount: string; isNew: boolean };

export default function PartTimeView() {
  const { askAssistant } = useDesk();
  const [items, setItems] = useState<Gig[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [kind, setKind] = useState<"all" | Gig["type"]>("all"), [query, setQuery] = useState(""), [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Gig | null>(null), [payment, setPayment] = useState<PaymentDraft | null>(null), [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try { const data = await readJson<{ items: Gig[] }>(await fetch("/api/part-time", { cache: "no-store" })); setItems(data.items); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(reload); }, [reload]);
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener("runway:part-time-changed", refresh);
    return () => window.removeEventListener("runway:part-time-changed", refresh);
  }, [reload]);
  useEffect(() => {
    if (!editing && !payment) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, payment]);
  const totals = useMemo(() => incomeTotals(items), [items]);
  const visible = items.filter(item => item.archived === archived && (kind === "all" || item.type === kind) && [item.title, item.organization, item.notes, item.nextAction].join(" ").toLowerCase().includes(query.toLowerCase()));
  async function persist(item: Gig) {
    const parsed = gigSchema.safeParse(item);
    if (!parsed.success) throw Error(parsed.error.issues[0].message);
    const response = await readJson<{ item: Gig }>(await fetch("/api/part-time", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }));
    setItems(old => [response.item, ...old.filter(i => i.id !== response.item.id)]);
    return response.item;
  }
  async function saveEditor() {
    if (!editing) return;
    setBusy(true);
    try { await persist(editing); setEditing(null); toast.success("兼职已保存"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  function editPayment(item: Gig, existing?: Income) {
    const last = item.payments.filter(p => !p.voided).at(-1);
    setPayment({ item, isNew: !existing, amount: existing ? (existing.amountMinor / 100).toFixed(existing.currency === "JPY" ? 0 : 2) : "", payment: existing ?? { id: crypto.randomUUID(), amountMinor: 0, currency: last?.currency ?? "HKD", status: "received", date: today(), period: "", note: "", voided: false } });
  }
  async function savePayment() {
    if (!payment) return;
    setBusy(true);
    try {
      const parsed = incomeSchema.safeParse({ ...payment.payment, amountMinor: parseAmount(payment.amount) });
      if (!parsed.success) throw Error(parsed.error.issues[0].message);
      const next = payment.isNew ? [...payment.item.payments, parsed.data] : payment.item.payments.map(p => p.id === parsed.data.id ? parsed.data : p);
      await persist({ ...payment.item, payments: next }); setPayment(null); toast.success("收入记录已保存");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function toggleArchive(item: Gig) {
    setBusy(true);
    try { await persist({ ...item, archived: !item.archived }); toast.success(item.archived ? "已恢复" : "已归档，收入仍计入统计"); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  function exportData() {
    const blob = new Blob([JSON.stringify({ format: "runway-part-time-v1", exportedAt: new Date().toISOString(), items }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `runway-part-time-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const setField = <K extends keyof Gig>(key: K, value: Gig[K]) => setEditing(item => item && ({ ...item, [key]: value }));
  const setIncome = <K extends keyof Income>(key: K, value: Income[K]) => setPayment(draft => draft && ({ ...draft, payment: { ...draft.payment, [key]: value } }));

  return <>
    <PageHeader title="兼职与收入" description="一次性的小任务、长期合作，以及持续产生的平台收入。" actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={loading || !!error} onClick={exportData}><ArrowDownToLine />导出</Button><Button variant="outline" onClick={() => askAssistant("帮我添加一条兼职：")}><Sparkles />AI 添加</Button><Button onClick={() => setEditing(newGig(kind === "all" ? "task" : kind))}><Plus />添加兼职</Button></div>} />
    {error && <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}<Button variant="outline" size="sm" onClick={() => void reload()}>重新加载</Button></div>}
    <div className="mb-2 grid gap-3 sm:grid-cols-3">{([
      ["本月到账", "month"], ["累计到账", "received"], ["待到账", "pending"],
    ] as const).map(([label, key]) => <section key={key} className="rounded-xl border bg-card p-4"><h2 className="text-xs text-muted-foreground">{label}</h2>
      <div className="mt-2 space-y-1">{loading ? <p className="text-lg text-muted-foreground">—</p> : totals.length ? totals.map(total => <p key={total.currency} className="tabular text-lg font-semibold">{formatMoney(total[key], total.currency)}</p>) : <p className="text-lg text-muted-foreground">暂无记录</p>}</div>
    </section>)}</div>
    <p className="mb-6 text-xs text-muted-foreground">不同币种分开统计，不自动换算。统计包含已归档兼职，作废的收入不计入。</p>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="max-w-full overflow-x-auto"><Segmented value={kind} onChange={setKind} options={[{ value: "all", label: "全部" }, ...Object.entries(gigTypes).map(([value, label]) => ({ value: value as Gig["type"], label }))]} /></div>
      <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索兼职" placeholder="搜索任务、平台、备注…" className="bg-card pl-8" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />查看已归档</label>
    </div>
    {loading ? <div className="h-36 animate-pulse rounded-xl bg-muted" /> : visible.length ? <div className="grid gap-4">{visible.map(item => {
      const itemTotals = incomeTotals([item]);
      return <article key={item.id} className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex items-start gap-3"><span className="rounded-lg bg-accent p-2 text-primary">{item.type === "task" ? <ClipboardList className="size-5" /> : <Wallet className="size-5" />}</span>
          <div className="min-w-0 flex-1"><h2 className="break-words text-base font-semibold">{item.title}</h2><p className="mt-1 text-xs text-muted-foreground">{gigTypes[item.type]}{item.organization && ` · ${item.organization}`}</p></div><Pill tone={item.status === "进行中" ? "blue" : item.status === "已完成" ? "green" : "gray"}>{item.status}</Pill></div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">报酬 / 结算约定</p><p className="mt-1 whitespace-pre-wrap break-words">{item.compensation || "尚未填写"}</p></div><div><p className="text-xs text-muted-foreground">下一步{item.dueDate ? ` · ${item.dueDate}` : ""}</p><p className="mt-1 whitespace-pre-wrap break-words">{item.nextAction || "尚未安排"}</p></div></div>
        {itemTotals.length > 0 && <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t pt-3 text-xs">{itemTotals.map(total => <p key={total.currency}><span className="text-muted-foreground">已到账 </span><b className="tabular">{formatMoney(total.received,total.currency)}</b><span className="ml-3 text-muted-foreground">待到账 {formatMoney(total.pending,total.currency)}</span></p>)}</div>}
        {item.notes && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.notes}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2"><Button size="sm" disabled={busy} onClick={() => editPayment(item)}><Plus />记收入</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(item)}><Pencil />编辑</Button>
          {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 text-xs text-primary hover:underline"><ExternalLink className="size-3.5" />打开链接</a>}
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void toggleArchive(item)}><Archive />{item.archived ? "恢复" : "归档"}</Button></div>
        {item.payments.length > 0 && <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-medium">收入明细 · {item.payments.filter(p => !p.voided).length} 笔</summary>
          <ul className="mt-2 divide-y">{[...item.payments].sort((a,b) => b.date.localeCompare(a.date)).map(p => <li key={p.id} className={cn("flex items-start gap-3 py-3", p.voided && "opacity-50")}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={cn("tabular font-medium", p.voided && "line-through")}>{formatMoney(p.amountMinor,p.currency)}</span><Pill tone={p.voided ? "gray" : p.status === "received" ? "green" : "amber"}>{p.voided ? "已作废" : p.status === "received" ? "已到账" : "待到账"}</Pill></div><p className="mt-1 text-xs text-muted-foreground">{p.date}{p.period && ` · ${p.period}`}</p>{p.note && <p className="mt-1 break-words text-xs text-muted-foreground">{p.note}</p>}</div><Button variant="ghost" size="sm" aria-label={`编辑 ${p.date} ${formatMoney(p.amountMinor,p.currency)} 收入`} disabled={busy} onClick={() => editPayment(item,p)}><Pencil /></Button></li>)}</ul>
        </details>}
      </article>;
    })}</div> : <EmptyState icon={<Wallet />} title={items.some(i => i.archived === archived) || archived ? "没有符合条件的兼职" : "从一份小任务，或一项持续收入开始"} description={archived ? "归档后可在这里恢复，历史收入会一直保留。" : "为每项兼职建一条记录，完成任务后记下报酬；长期合作和平台收入可以持续记账。"}
      action={!archived && <div className="flex flex-wrap justify-center gap-2">{(Object.keys(gigTypes) as Gig["type"][]).map((type, i) => <Button key={type} size="sm" variant={i ? "outline" : "default"} onClick={() => setEditing(newGig(type))}>{gigTypes[type]}</Button>)}</div>} />}

    <Dialog open={!!editing} onOpenChange={open => { if (!open && !busy) setEditing(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogTitle>{editing?.revision ? "编辑兼职" : "添加兼职"}</DialogTitle><DialogDescription>记录任务与合作安排，具体到账金额在「记收入」中逐笔登记。</DialogDescription>
      {editing && <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void saveEditor(); }}>
        <Field label="名称"><Input required autoFocus maxLength={300} placeholder="例如：用户访谈、家教、平台分成" value={editing.title} onChange={e => setField("title",e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="类型"><select className={selectClass} value={editing.type} onChange={e => setField("type",e.target.value as Gig["type"])}>{Object.entries(gigTypes).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="状态"><select className={selectClass} value={editing.status} onChange={e => setField("status",e.target.value as Gig["status"])}>{gigStatuses.map(value => <option key={value}>{value}</option>)}</select></Field></div>
        <Field label="平台 / 合作方"><Input value={editing.organization} onChange={e => setField("organization",e.target.value)} /></Field>
        <Field label="报酬 / 结算约定"><Input placeholder="例如：HK$300/次、按月结算、按平台分成" value={editing.compensation} onChange={e => setField("compensation",e.target.value)} /></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="下一步"><Input value={editing.nextAction} onChange={e => setField("nextAction",e.target.value)} /></Field><Field label="任务 / 下次跟进日期"><Input type="date" value={editing.dueDate} onChange={e => setField("dueDate",e.target.value)} /></Field></div>
        <Field label="相关链接"><Input type="url" placeholder="https://" value={editing.url} onChange={e => setField("url",e.target.value)} /></Field>
        <Field label="备注"><Textarea rows={3} placeholder="工作内容、参与条件、结算方式…" value={editing.notes} onChange={e => setField("notes",e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}保存兼职</Button></div>
      </form>}
    </DialogContent></Dialog>
    <Dialog open={!!payment} onOpenChange={open => { if (!open && !busy) setPayment(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogTitle>{payment?.isNew ? "记收入" : "编辑收入"}</DialogTitle><DialogDescription>{payment?.item.title} · 待到账的款项确认收到后，可改为已到账。</DialogDescription>
      {payment && <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void savePayment(); }}>
        <div className="grid grid-cols-2 gap-4"><Field label="金额"><Input required inputMode="decimal" placeholder="0.00" value={payment.amount} onChange={e => setPayment({ ...payment, amount:e.target.value })} /></Field><Field label="币种"><select className={selectClass} value={payment.payment.currency} onChange={e => setIncome("currency",e.target.value as Income["currency"])}>{currencies.map(value => <option key={value}>{value}</option>)}</select></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="到账状态"><select className={selectClass} value={payment.payment.status} onChange={e => setIncome("status",e.target.value as Income["status"])}><option value="received">已到账</option><option value="pending">待到账</option></select></Field>
          <Field label={payment.payment.status === "received" ? "到账日期" : "预计到账日期"}><Input required type="date" max={payment.payment.status === "received" ? today() : undefined} value={payment.payment.date} onChange={e => setIncome("date",e.target.value)} /></Field></div>
        <Field label="收入所属期间 / 批次"><Input placeholder="例如：2026 年 9 月、第二次访谈" value={payment.payment.period} onChange={e => setIncome("period",e.target.value)} /></Field>
        <Field label="备注"><Textarea rows={3} value={payment.payment.note} onChange={e => setIncome("note",e.target.value)} /></Field>
        {!payment.isNew && <Label className="flex items-center gap-2"><input type="checkbox" checked={payment.payment.voided} onChange={e => setIncome("voided",e.target.checked)} />作废此记录（可恢复，不计入统计）</Label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setPayment(null)}>取消</Button><Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}保存收入</Button></div>
      </form>}
    </DialogContent></Dialog>
  </>;
}
