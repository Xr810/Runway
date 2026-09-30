"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, History, ImageDown, LoaderCircle, LockKeyhole, RefreshCw, ScanSearch, Unlock, UserRound } from "lucide-react";
import { toast } from "sonner";
import { type Assessment, type EvaluationProfile, type EnrichmentTarget, weightPresets, type EvaluationWeights } from "@/lib/enrichment-contract";
import { type Entry } from "@/lib/model";
import { score } from "@/lib/model";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk } from "./store";
import { readJson } from "@/lib/api-response";
import { CompanyMark, EmptyState, Pill, stamp, type Tone } from "./ui";

export type BrandResult = { kind: "brand"; assetUrl: string; summary: string; model: string; website: string; sourceUrl: string; imageUrl: string };
export type EnrichmentState = { kind: string; target_id: string; locked: boolean; manualLogo?: boolean; result_id: string | null; result: Assessment | BrandResult | null; stale: boolean; created: string; actor: string };
type Task = { id: string; kind: string; target_id: string; name: string; status: string; error: string; created: string };
export type EnrichmentFeed = { tasks: Task[]; states: EnrichmentState[]; profile: EvaluationProfile; history: { id: string; result: Assessment | BrandResult; input: { profile?: EvaluationProfile; rubric: { version: string } }; actor: string; created: string }[]; nextOffset: number | null };

export async function enrichmentRequest(body?: unknown, path = "/api/enrichment") {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  return readJson<Awaited<ReturnType<Response["json"]>>>(r);
}
export function useEnrichment() {
  const { setBrandLogos } = useDesk();
  const [feed, setFeed] = useState<EnrichmentFeed | null>(null), [error, setError] = useState("");
  const apply = useCallback((d: EnrichmentFeed) => {
    setFeed(d); setError("");
    const logos: Record<string, string> = {}; for (const s of d.states) if (s.result?.kind === "brand") logos[s.kind + ":" + s.target_id] = s.result.assetUrl;
    setBrandLogos(logos);
  }, [setBrandLogos]);
  const reload = useCallback(async () => { try { apply(await enrichmentRequest()); } catch (e) { setError((e as Error).message); } }, [apply]);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const d = await enrichmentRequest(); if (active) apply(d); } catch (e) { if (active) setError((e as Error).message); } };
    void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    return () => { active = false; clearInterval(timer); };
  }, [apply]);
  return { feed, error, reload };
}

export const taskStatus: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "排队中", tone: "gray" }, running: { label: "处理中", tone: "blue" }, completed: { label: "已完成", tone: "green" }, failed: { label: "需要重试", tone: "red" }, superseded: { label: "资料已更新", tone: "gray" },
};
const factors = [["fit", "岗位匹配度"], ["career", "职业路径与成长"], ["returnOffer", "Return Offer / 转正"], ["academic", "学术与升学帮助"], ["outlook", "公司 / 行业前景"]] as const satisfies readonly (readonly [keyof Assessment, string])[];
const confidence = { high: "高", medium: "中", low: "低" };

/** Assessment or brand history for one target, with lock and re-run controls. */
export function EvaluationTimeline({ target, onSaved, compact = false }: { target: EnrichmentTarget; onSaved?: () => void; compact?: boolean }) {
  const [feed, setFeed] = useState<EnrichmentFeed | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/enrichment?kind=${target.kind}&id=${encodeURIComponent(target.id)}`;
  const load = useCallback(async () => { try { setFeed(await enrichmentRequest(undefined, url)); setError(""); } catch (e) { setError((e as Error).message); } }, [url]);
  useEffect(() => { let active = true; enrichmentRequest(undefined, url).then(d => { if (active) setFeed(d); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [url]);
  useEffect(() => {
    if (!feed?.tasks.some(t => t.status === "pending" || t.status === "running")) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [feed, load]);
  const state = feed?.states.find(s => s.kind === target.kind && s.target_id === target.id);
  const task = feed?.tasks[0];
  const isJob = target.kind === "job";
  const visibleHistory = isJob ? feed?.history.slice(0, 1) : feed?.history;
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try { const r = await enrichmentRequest(body); toast.success("locked" in body ? (body.locked ? "已锁定当前结果" : "已解除锁定") : `已加入 ${r.queued} 个任务${r.skipped ? `，跳过 ${r.skipped} 个` : ""}`); await load(); onSaved?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function more() {
    if (!feed?.nextOffset) return; setBusy(true);
    try { const next: EnrichmentFeed = await enrichmentRequest(undefined, url + "&offset=" + feed.nextOffset); setFeed({ ...next, history: [...feed.history, ...next.history] }); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      {state?.locked ? <Pill tone="amber"><LockKeyhole className="size-3" />已锁定</Pill> : task ? <Pill tone={taskStatus[task.status]?.tone}>{taskStatus[task.status]?.label ?? task.status}</Pill> : <Pill>尚未处理</Pill>}
      {state?.stale && <Pill tone="amber">资料已变化，结果可能过时</Pill>}
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" disabled={busy || !feed || state?.manualLogo} onClick={() => void act({ action: "lock", target, locked: !state?.locked })}>
          {state?.locked ? <Unlock /> : <LockKeyhole />}{state?.locked ? "解除锁定" : "锁定结果"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !!state?.locked || !!state?.manualLogo || !feed} onClick={() => void act({ action: "run", scope: isJob ? "job" : "brand", target, force: true })}>
          {busy ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}重新{isJob ? "评估" : "获取"}
        </Button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-400/10 dark:text-red-300">{error}</p>}
    {state?.manualLogo && <p className="text-xs text-muted-foreground">正在使用手动设置的图标。清空公司资料里的图标地址后才会恢复自动获取。</p>}
    {task?.error && !state?.locked && <p className="text-xs text-muted-foreground">最近一次任务：{task.error}</p>}
    {!feed ? <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取…</div>
      : !visibleHistory?.length ? <EmptyState icon={<History />} title={isJob ? "还没有评估结果" : "还没有图标记录"} description={isJob ? "点击评估后，内置模型会直接生成评分、依据与来源。" : "补全图标后，来源页面与历史会记录在这里。"} className={compact ? "py-8" : undefined} />
      : <ol className="flex flex-col gap-3">{visibleHistory.map((item, index) => <li key={item.id} className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {index === 0 && <Pill tone="blue">最新</Pill>}<span>{stamp(item.created)}</span><span>·</span><span>{item.actor}</span><span className="ml-auto font-mono text-[11px]">{item.result.model}</span>
        </div>
        <p className="text-sm leading-relaxed">{item.result.summary}</p>
        {item.result.kind === "assessment" ? <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{factors.map(([key, label]) => { const f = (item.result as Assessment)[key] || {score:null,reason:"暂无依据",confidence:"low" as const,evidence:[]}; const used = (item.input.rubric as {weights?:EvaluationWeights})?.weights?.[key] ?? 0; return <div key={key} className="rounded-lg bg-muted/60 p-3">
            <div className="flex items-baseline justify-between"><span className="text-xs text-muted-foreground">{label}{used?` · ${used}%`:""}</span><span className="tabular text-lg font-semibold">{f.score ?? "待核实"}</span></div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.reason}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">可信度 {confidence[f.confidence]}</p>
            {f.evidence.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">{f.evidence.map((v, i) => <li key={i}>{v}</li>)}</ul>}
          </div>; })}</div>
          {item.result.hardConstraints.length > 0 && <div className="mt-3 space-y-1.5">{item.result.hardConstraints.map((c, i) => <p key={i} className="flex gap-2 text-xs"><Pill tone={c.status === "met" ? "green" : c.status === "unmet" ? "red" : "gray"}>{{ met: "符合", unmet: "不符合", unknown: "待核实" }[c.status]}</Pill><span><b className="font-medium">{c.label}</b> — {c.reason}</span></p>)}</div>}
          {item.result.missing.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">待补充：{item.result.missing.join("；")}</p>}
          {item.result.sources.length > 0 && <div className="mt-3 flex flex-col gap-1">{item.result.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"><ExternalLink className="size-3" />{s.title}<span className="text-muted-foreground">· {stamp(s.checkedAt)}</span></a>)}</div>}
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-muted-foreground">当时使用的个人背景</summary><pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-3 whitespace-pre-wrap font-sans">{[item.input.profile?.background, item.input.profile?.goals, item.input.profile?.preferences].filter(Boolean).join("\n\n") || "尚未配置背景"}</pre></details>
        </> : <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={item.result.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" />官方来源页面</a>
          <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={item.result.imageUrl} target="_blank" rel="noreferrer"><ImageDown className="size-3" />原始图标</a>
        </div>}
      </li>)}</ol>}
    {!isJob && feed?.nextOffset != null && <Button variant="ghost" size="sm" disabled={busy} onClick={() => void more()}>加载更早的记录</Button>}
  </div>;
}

/** Global dialog, opened through the store (used for company and channel icons). */
export function EvaluationDialog() {
  const { evaluation, openEvaluation, reload } = useDesk();
  return <Dialog open={!!evaluation} onOpenChange={open => { if (!open) openEvaluation(null); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{evaluation?.kind === "job" ? "最新评估依据" : "图标来源与历史"}</DialogTitle>
        <DialogDescription>{evaluation?.kind === "job" ? "这里只显示最新一版评估。锁定后，自动任务和重跑都不会覆盖当前结果。" : "每次图标更新都会保留来源记录。"}</DialogDescription></DialogHeader>
      {evaluation && <EvaluationTimeline key={evaluation.kind + ":" + evaluation.id} target={evaluation} onSaved={() => void reload()} />}
    </DialogContent>
  </Dialog>;
}

/** Queue overview for all job assessments. */
export function EvaluationQueue({ entries }: { entries: Entry[] }) {
  const { reload, openEntry, logoFor } = useDesk();
  const { feed, error, reload: reloadFeed } = useEnrichment();
  const [busy, setBusy] = useState(false);
  const [customWeights, setCustomWeights] = useState<EvaluationWeights | null>(null);
  const profile = feed?.profile;
  const weights:EvaluationWeights = profile?.evaluationWeights || weightPresets.balanced.weights;
  async function saveWeights(preset: EvaluationProfile["evaluationPreset"], nextWeights: EvaluationWeights) {
    if (!profile) return;
    const total = Object.values(nextWeights).reduce((a,b)=>a+b,0);
    if (total !== 100) { toast.error(`权重总和需为 100%，目前为 ${total}%`); return; }
    setBusy(true);
    try { await enrichmentRequest({action:"profile",profile:{...profile,evaluationPreset:preset,evaluationWeights:nextWeights}}); await reloadFeed(); toast.success("评估权重已保存；旧评分会按新权重即时重算"); }
    catch(e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const latest = new Map<string, Task>(); for (const t of feed?.tasks || []) if (t.kind === "job" && !latest.has(t.target_id)) latest.set(t.target_id, t);
  async function queue(force: boolean) {
    setBusy(true);
    try { const r = await enrichmentRequest({ action: "run", scope: "job", force }); toast.success(`已安排 ${r.queued} 个任务，跳过 ${r.skipped} 个已完成或锁定的岗位`); await reloadFeed(); await reload(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const missingProfile = feed && (!feed.profile.background.trim() || !feed.profile.goals.trim());
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => void queue(false)}>{busy ? <LoaderCircle className="animate-spin" /> : <ScanSearch />}评估未处理的岗位</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void queue(true)}><RefreshCw />全部重新评估</Button>
      <Button size="sm" variant="ghost" asChild><Link href="/settings?section=profile"><UserRound />个人背景</Link></Button>
      <span className="ml-auto text-xs text-muted-foreground">综合分按已知项目加权归一化；未知项不猜分。</span>
    </div>
    {profile && <section className="rounded-xl border bg-card p-3" aria-label="评估权重">
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">评估侧重</span>
        {Object.entries(weightPresets).map(([key,value])=><Button key={key} size="sm" variant={profile.evaluationPreset===key?"default":"outline"} disabled={busy} onClick={()=>void saveWeights(key as EvaluationProfile["evaluationPreset"],value.weights)}>{value.label}</Button>)}
        <Button size="sm" variant={profile.evaluationPreset==="custom"?"default":"outline"} disabled={busy} onClick={()=>{setCustomWeights(weights);void saveWeights("custom",weights)}}>自定义</Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">默认均衡：匹配 25% · 成长 25% · 转正 20% · 学术 15% · 公司前景 15%。证据不足时显示待核实，综合分只按有分数的维度重新归一化。</p>
      {profile.evaluationPreset==="custom" && <div className="mt-3 grid gap-2"> <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{factors.map(([key,label])=><label key={key} className="grid gap-1 text-xs text-muted-foreground">{label} · {(customWeights||weights)[key as keyof EvaluationWeights]}%<input aria-label={label+"权重"} type="number" min="0" max="100" step="5" value={(customWeights||weights)[key as keyof EvaluationWeights]} onChange={e=>{const v=Math.max(0,Math.min(100,Number(e.target.value)||0));setCustomWeights({...customWeights||weights,[key]:v});}} className="h-8 rounded-md border bg-background px-2 text-foreground" /></label>)}</div><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">当前合计：{Object.values(customWeights||weights).reduce((a,b)=>a+b,0)}%</span><Button size="sm" disabled={busy||!customWeights||Object.values(customWeights).reduce((a,b)=>a+b,0)!==100} onClick={()=>customWeights&&void saveWeights("custom",customWeights)}>保存自定义权重</Button></div></div>}
    </section>}
    {missingProfile && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">还没有填写个人背景或职业目标。缺失时，匹配度和职业发展评分会保持空白。<Link href="/settings?section=profile" className="ml-1 font-medium underline">去填写</Link></p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    <div className="overflow-hidden rounded-xl border bg-card">
      {entries.length ? entries.map(e => {
        const s = feed?.states.find(x => x.kind === "job" && x.target_id === e.id), t = latest.get(e.id), r = s?.result?.kind === "assessment" ? s.result : null;
        const partial = !!r && factors.some(([key]) => (r[key] as {score:number|null}|undefined)?.score === null || !r[key]);
        const status = s?.locked ? { label: "已锁定", tone: "amber" as Tone } : s?.stale ? { label: "待更新", tone: "amber" as Tone } : partial && t?.status === "completed" ? { label: "资料不足", tone: "amber" as Tone } : t ? taskStatus[t.status] : { label: "未评估", tone: "gray" as Tone };
        const weighted = score(e,weights,r?{returnOffer:r.returnOffer?.score??null,academic:r.academic?.score??null}:undefined);
        return <button key={e.id} onClick={() => openEntry(e.id)} className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/50">
          <CompanyMark name={e.organization} src={logoFor(e.organization)} size="sm" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.title}</p><p className="truncate text-xs text-muted-foreground">{e.organization} · {r?.summary || t?.error || "等待评估"}</p></div>
          <div className="hidden text-right text-xs text-muted-foreground sm:block">{r ? <>{factors.map(([key,label],i)=>{const f=r[key] || {score:null,reason:"暂无依据"};return <span key={key} title={f.reason}>{i?" · ":""}{label} {f.score===null?"待核实":f.score}</span>})}</> : <>匹配 {e.fit ?? "—"} · 成长 {e.career ?? "—"} · 转正 {e.returnOffer ?? "—"} · 学术 {e.academic ?? "—"} · 前景 {e.outlook ?? "—"}</>}</div>
          <span className="tabular w-8 text-right font-semibold">{weighted===null?"—":weighted.toFixed(1)}</span>
          <Pill tone={status?.tone}>{status?.label}</Pill>
        </button>;
      }) : <EmptyState icon={<ScanSearch />} title="还没有岗位" className="border-0" />}
    </div>
  </div>;
}

/** Queues icon tasks and fetches each official icon from the company or channel website. */
export async function scanBrands(force: boolean) {
  let done = 0, failed = 0; const id = toast.loading("正在准备图标任务…");
  try {
    await enrichmentRequest({ action: "queue", scope: "brand", force });
    const fresh: EnrichmentFeed = await enrichmentRequest();
    const ids = fresh.tasks.filter(t => t.kind !== "job" && t.status === "pending").map(t => t.id);
    for (const taskId of ids) { toast.loading(`正在获取官方图标 ${done + failed + 1} / ${ids.length}`, { id }); try { await enrichmentRequest({ taskId }, "/api/enrichment/scan"); done++; } catch { failed++; } }
    toast.success(ids.length ? `已缓存 ${done} 个图标${failed ? `，${failed} 个没找到，可以让 AI 补全官网后再试` : ""}` : "没有需要补全的图标", { id });
  } catch (e) { toast.error((e as Error).message, { id }); }
}
