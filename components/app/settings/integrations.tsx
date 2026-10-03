"use client";
import { useEffect, useState } from "react";
import { Copy, ExternalLink, KeyRound, LoaderCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readJson, postJson } from "../store";
import { Panel, Pill, stamp } from "../ui";

type Client = { id: string; name: string; token_hint: string; created: string; revoked_at: string | null; last_used_at: string | null };

export default function IntegrationSettings() {
  const [clients, setClients] = useState<Client[]>([]), [name, setName] = useState("Muse"), [token, setToken] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [base, setBase] = useState("");
  useEffect(() => { let active = true; fetch("/api/settings/integrations", { cache: "no-store" }).then(r => readJson<{ clients: Client[] }>(r)).then(d => { if (active) { setClients(d.clients); setBase(window.location.origin + "/api/integrations/v1"); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  async function run(body: unknown) {
    setBusy(true); setError(""); setMessage("");
    try { const result = await postJson<{ token?: string }>("/api/settings/integrations", body); setToken(result.token || ""); setClients((await readJson<{ clients: Client[] }>(await fetch("/api/settings/integrations", { cache: "no-store" }))).clients); setMessage(result.token ? "已创建。请现在复制密钥，离开页面后不会再显示。" : "访问已撤销。"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-5">
    <div><h3 className="text-base font-semibold">Muse 接入</h3><p className="mt-1 text-sm text-muted-foreground">Muse 在自己的服务器上读取邮件、抓取招聘网站，再通过这里的接口同步。接口写入会直接保存，并生成一条通知。</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-400/10 dark:text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">{message}</p>}
    <Panel title="接入地址">
      <div className="flex flex-col gap-3 text-sm">
        <Input readOnly value={base} aria-label="接口地址" className="font-mono text-xs" />
        <p className="text-muted-foreground">认证请求头：<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">Authorization: Bearer &lt;API Key&gt;</code></p>
        <p className="text-xs text-muted-foreground">如果网站部署在 Cloudflare Access 等访问网关后面，外部服务除了这里的 API Key，还需要网关自己的凭据。</p>
        <p className="text-xs text-muted-foreground">允许：读取关注公司与岗位；新增岗位、更新状态和日程、发送通知；读取个人背景、领取并回写评估与图标任务。不允许：删除岗位、读取模型密钥、修改网站设置。</p>
        <div className="flex flex-wrap gap-4"><a className="inline-flex items-center gap-1 text-primary hover:underline" href="/integrations-guide.html" target="_blank" rel="noreferrer">接入说明与请求示例<ExternalLink className="size-3.5" /></a><a className="inline-flex items-center gap-1 text-primary hover:underline" href="/muse-tasks-guide.md" target="_blank" rel="noreferrer">评估与图标任务协议<ExternalLink className="size-3.5" /></a></div>
      </div>
    </Panel>
    <Panel title="API Key" description="每个集成使用单独的密钥，可以随时撤销。">
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2"><div className="grid flex-1 gap-1.5"><Label htmlFor="int-name">集成名称</Label><Input id="int-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></div>
          <Button disabled={busy || !name.trim()} onClick={() => void run({ action: "create", name })}>{busy ? <LoaderCircle className="animate-spin" /> : <Plug />}创建密钥</Button></div>
        {token && <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-400/30 dark:bg-amber-400/10"><p className="text-xs font-medium text-amber-900 dark:text-amber-200">新密钥，只显示这一次</p>
          <div className="flex gap-2"><Input readOnly value={token} className="font-mono text-xs" aria-label="新密钥" autoComplete="off" /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(token); setMessage("已复制"); } catch { setError("复制失败，请手动选中复制"); } }}><Copy />复制</Button><Button variant="ghost" onClick={() => setToken("")}>隐藏</Button></div></div>}
        {clients.length > 0 && <ul className="overflow-hidden rounded-lg border">{clients.map(c => <li key={c.id} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
          <KeyRound className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{c.name}</p><p className="text-xs text-muted-foreground"><code className="font-mono">••••{c.token_hint}</code> · {c.revoked_at ? "已撤销" : c.last_used_at ? "最近调用 " + stamp(c.last_used_at) : "尚未调用"}</p></div>
          {c.revoked_at ? <Pill>已撤销</Pill> : <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => { if (window.confirm(`撤销 ${c.name} 的访问？撤销后它将无法继续同步。`)) void run({ action: "revoke", id: c.id }); }}>撤销</Button>}
        </li>)}</ul>}
      </div>
    </Panel>
  </div>;
}
