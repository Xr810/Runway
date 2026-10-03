"use client";
import { useCallback, useEffect, useState } from "react";
import { Bot, Building2, ChevronDown, ImageDown, LoaderCircle, Radar, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDesk, readJson, postJson } from "./store";
import { scanBrands } from "./evaluation";
import { relativeDay, stamp } from "./ui";

export type ScanRun = { id?: string; watch_id: string; trigger?: string; status: "running" | "ok" | "failed"; started_at: string; finished_at: string | null; found: number; judged: number; added: number; error: string; detail: { source?: string; filtered?: number; deferred?: number } };
export type ScanSettings = { enabled: boolean; time: string; maxAddPerWatch: number };
type Overview = { settings: ScanSettings; running: boolean; configured: boolean; lastRuns: Record<string, ScanRun>; runs?: ScanRun[] };

/** Scan status for all watches; polls while a scan is running. */
export function useScan(withHistory = false) {
  const { reload, refreshNotifications } = useDesk();
  const [overview, setOverview] = useState<Overview | null>(null), [starting, setStarting] = useState(false);
  const load = useCallback(async () => { try { setOverview(await readJson<Overview>(await fetch("/api/scan" + (withHistory ? "?history" : ""), { cache: "no-store" }))); } catch { /* shown as unavailable */ } }, [withHistory]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const running = overview?.running;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => { clearInterval(timer); void reload(); void refreshNotifications(); };
  }, [running, load, reload, refreshNotifications]);
  async function run(watchIds?: string[]) {
    setStarting(true);
    try { await postJson("/api/scan", { action: "run", ...(watchIds ? { watchIds } : {}) }); toast.success("开始扫描，找到合适的岗位会自动加入并通知你"); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setStarting(false); }
  }
  return { overview, load, run, busy: starting || !!running };
}

export function ScanStatus({ run, className }: { run?: ScanRun; className?: string }) {
  if (!run) return <span className={cn("text-xs text-muted-foreground", className)}>还没有扫描过</span>;
  if (run.status === "running") return <span className={cn("inline-flex items-center gap-1 text-xs text-primary", className)}><LoaderCircle className="size-3 animate-spin" />正在扫描…</span>;
  const when = relativeDay(new Date(run.started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }));
  if (run.status === "failed") return <span className={cn("text-xs text-red-600 dark:text-red-400", className)} title={run.error}>{when}扫描失败：{run.error}</span>;
  return <span className={cn("text-xs text-muted-foreground", className)} title={stamp(run.started_at)}>{when}扫描 · 找到 {run.found} 个{run.added ? <>，<b className="font-medium text-emerald-700 dark:text-emerald-400">新增 {run.added}</b></> : "，没有新岗位"}{run.detail?.source ? ` · ${run.detail.source}` : ""}</span>;
}

/** Scan now, complete company details, and icon maintenance in one menu. */
export function AutomationMenu({ scan }: { scan: ReturnType<typeof useScan> }) {
  const { reload } = useDesk();
  const [completing, setCompleting] = useState(false);
  async function complete() {
    setCompleting(true);
    try {
      const started = await postJson<{ runId: string }>("/api/companies/complete", {});
      const id = toast.loading("AI 正在补全公司官网、图标和类型…");
      let complete = false;
      try {
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 4000));
          const state = await readJson<{ run?: { id: string; status: string; error?: string } }>(await fetch("/api/companies/complete", { cache: "no-store" }));
          if (state.run?.id !== started.runId) throw Error("任务状态已变化，请查看公司资料后重试。");
          if (state.run.status === "failed") throw Error(state.run.error || "公司资料补全失败");
          if (state.run.status === "no_updates") throw Error("没有找到可更新的公司资料，详见通知。");
          if (state.run.status === "completed") { complete = true; break; }
        }
        if (!complete) throw Error("任务仍在后台处理中，尚未确认完成。");
      } catch (e) { toast.dismiss(id); throw e; }
      toast.success("公司资料补全完成，结果见通知", { id }); await reload();
    } catch (e) { toast.error((e as Error).message); } finally { setCompleting(false); }
  }
  const busy = scan.busy || completing;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="bg-card">{busy ? <LoaderCircle className="animate-spin" /> : <Bot />}自动化<ChevronDown className="opacity-60" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{scan.overview?.settings.enabled ? `每天 ${scan.overview.settings.time} 自动扫描已开启的关注` : "自动扫描已关闭，可在设置里开启"}</DropdownMenuLabel>
      <DropdownMenuItem disabled={scan.busy} onSelect={() => void scan.run()}><Radar />立即扫描全部关注</DropdownMenuItem>
      <DropdownMenuItem disabled={completing} onSelect={() => void complete()}><Building2 />AI 补全公司资料<span className="ml-auto text-xs text-muted-foreground">官网 · 图标 · 类型</span></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void scanBrands(false).then(reload)}><ImageDown />只补全缺失的图标</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void scanBrands(true).then(reload)}><RefreshCw />全部重新获取图标</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
