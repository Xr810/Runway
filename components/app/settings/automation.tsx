"use client";
import { useState } from "react";
import Link from "next/link";
import { LoaderCircle, Radar, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDesk, postJson } from "../store";
import { useScan, ScanStatus, type ScanSettings } from "../scan";
import { Panel, Pill, stamp } from "../ui";
import IntegrationSettings from "./integrations";

export default function AutomationSettings() {
  const { data } = useDesk();
  const scan = useScan(true);
  const [draft, setDraft] = useState<ScanSettings | null>(null), [busy, setBusy] = useState(false);
  const settings = draft ?? scan.overview?.settings;
  const watchName = (id: string) => data.watches.find(w => w.id === id)?.company ?? "已删除的关注";
  const enabledWatches = data.watches.filter(w => w.enabled).length;
  async function save() {
    if (!draft) return; setBusy(true);
    try { await postJson("/api/scan", { action: "settings", settings: draft }); setDraft(null); await scan.load(); toast.success("已保存"); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">自动化</h2><p className="mt-1 text-sm text-muted-foreground">Runway 每天扫描你关注的公司招聘页和招聘网站，用 AI 按你的求职方向挑出合适的岗位自动加入，并补全公司官网、图标和类型。</p></div>
    {scan.overview && !scan.overview.configured && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">自动扫描需要 AI 模型。请先在「AI 模型」里完成配置。</p>}
    <Panel title="每日扫描" description={`当前开启的关注：${enabledWatches} 个。关注列表在「公司」页维护。`}>
      {!settings ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : <div className="flex flex-col gap-4">
        <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">每天自动扫描<Switch checked={settings.enabled} onCheckedChange={v => setDraft({ ...settings, enabled: v })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5"><Label htmlFor="s-time">扫描时间</Label><Input id="s-time" type="time" value={settings.time} onChange={e => setDraft({ ...settings, time: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="s-max">每个关注每次最多加入</Label><Input id="s-max" type="number" min={1} max={20} value={settings.maxAddPerWatch} onChange={e => setDraft({ ...settings, maxAddPerWatch: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} /></div>
        </div>
        <p className="text-xs text-muted-foreground">扫描会跳过已经判断过的岗位，所以每天只处理新出现的职位。筛选标准来自 <Link href="/settings?section=profile" className="text-primary hover:underline">个人背景</Link> 里的简历和期待方向。</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !draft} onClick={() => void save()}>{busy ? <LoaderCircle className="animate-spin" /> : <Save />}保存</Button><Button variant="outline" disabled={scan.busy || !scan.overview?.configured} onClick={() => void scan.run()}>{scan.busy ? <LoaderCircle className="animate-spin" /> : <Radar />}立即扫描全部</Button></div>
      </div>}
    </Panel>
    <Panel title="最近的扫描" bodyClassName="p-0">
      {scan.overview?.runs?.length ? <ul>{scan.overview.runs.map(run => <li key={run.id} className="flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0">
        <div className="min-w-0 flex-1"><p className="truncate text-sm">{watchName(run.watch_id)}</p><ScanStatus run={run} className="block truncate" /></div>
        <div className="shrink-0 text-right text-xs text-muted-foreground"><Pill tone={run.status === "ok" ? "green" : run.status === "failed" ? "red" : "blue"}>{run.status === "ok" ? `判断 ${run.judged} · 加入 ${run.added}` : run.status === "failed" ? "失败" : "进行中"}</Pill><p className="mt-0.5">{stamp(run.started_at)} · {{ schedule: "定时", manual: "手动", assistant: "AI 助手" }[run.trigger ?? ""] ?? ""}</p></div>
      </li>)}</ul> : <p className="px-4 py-6 text-sm text-muted-foreground">还没有扫描记录。</p>}
    </Panel>
    <div className="border-t pt-5"><IntegrationSettings /></div>
  </div>;
}
