"use client";
import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, LoaderCircle, RefreshCw, Save, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readJson } from "../store";
import { useNavigationGuard } from "../navigation-guard-context";
import { Panel, Pill } from "../ui";

type Config = { base: string; model: string; hasKey: boolean; hasTavilyKey: boolean; revision: number; source: string; configured: boolean; mode: "personal" | "managed"; enabled: boolean; editable: boolean };

export default function AiSettings() {
  const { setGuard } = useNavigationGuard();
  const [saved, setSaved] = useState<Config | null>(null), [base, setBase] = useState(""), [apiKey, setKey] = useState(""), [tavilyApiKey, setTavilyKey] = useState(""), [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]), [search, setSearch] = useState(""), [busy, setBusy] = useState("load"), [error, setError] = useState(""), [notice, setNotice] = useState(""), [editingKey, setEditingKey] = useState(false), [editingTavilyKey, setEditingTavilyKey] = useState(false);
  const requestRef = useRef<AbortController | null>(null), generation = useRef(0);
  async function load() { setBusy("load"); setError(""); try { const v = await readJson<Config>(await fetch("/api/settings/ai", { cache: "no-store" })); setSaved(v); setBase(v.base); setModel(v.model); setKey(""); setTavilyKey(""); setEditingKey(false); setEditingTavilyKey(false); setModels([]); } catch (e) { setError((e as Error).message); } finally { setBusy(""); } }
  useEffect(() => { let active = true; fetch("/api/settings/ai", { cache: "no-store" }).then(r => readJson<Config>(r)).then(v => { if (active) { setSaved(v); setBase(v.base); setModel(v.model); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(""); }); return () => { active = false; requestRef.current?.abort(); }; }, []);
  const dirty = !!saved && (base !== saved.base || model !== saved.model || !!apiKey || !!tavilyApiKey);
  useEffect(() => { setGuard(dirty ? "AI 设置还没保存，确定离开吗？" : null); return () => setGuard(null); }, [dirty, setGuard]);
  function changeConnection() { generation.current++; requestRef.current?.abort(); setModels([]); setNotice(""); setError(""); setBusy(""); }
  async function run(action: "models" | "test" | "save") {
    if (!saved || busy) return;
    const number = ++generation.current, controller = new AbortController(); requestRef.current = controller; setBusy(action); setError(""); setNotice("");
    try {
      const result = await readJson<Config & { models: string[]; message: string }>(await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action, base, apiKey, tavilyApiKey, model, revision: saved.revision }) }));
      if (number !== generation.current) return;
      if (action === "models") { setModels(result.models); setNotice(result.models.length ? `读取到 ${result.models.length} 个模型。列表由当前 API 和密钥的权限决定。` : "接口没有返回模型，可以手动填写模型 ID。"); }
      if (action === "test") setNotice(result.message);
      if (action === "save") { setSaved(result); setBase(result.base); setModel(result.model); setKey(""); setTavilyKey(""); setEditingKey(false); setEditingTavilyKey(false); setNotice("已保存，下一条 AI 消息就会使用新配置。"); }
    } catch (e) { if (number === generation.current) setError(controller.signal.aborted ? "请求已取消。" : (e as Error).message); }
    finally { if (number === generation.current) { setBusy(""); requestRef.current = null; } }
  }
  const filtered = models.filter(id => id.toLowerCase().includes(search.toLowerCase()));
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">AI 模型</h2><p className="mt-1 text-sm text-muted-foreground">AI 助手使用的模型服务，支持任意 OpenAI 兼容 API。截图识别需要支持图片输入的模型。</p></div>
    {saved && <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm"><span className={saved.configured ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-amber-500"} />当前模型 <b className="font-medium">{saved.model || "未选择"}</b><Pill className="ml-auto">{saved.source === "environment" ? "部署默认配置" : "网站设置"}</Pill></div>}
    {saved && !saved.enabled && <div role="status" className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">此账户未启用 AI。AI 助手、联网搜索和自动补全均不可用。</div>}
    {saved?.enabled && saved.mode === "managed" && <div role="status" className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">AI 由部署管理员统一配置。个人设置、连接测试和模型列表不可用；密钥不会在此页面显示。</div>}
    {error && <div role="alert" className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-400/10 dark:text-red-300">{error}{!saved && <Button size="xs" variant="outline" onClick={() => void load()}>重试</Button>}</div>}
    {notice && <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"><Check className="size-4" />{notice}</div>}
    {busy === "load" ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取…</div> : saved?.editable && <>
      <Panel title="连接" description="填写接口根地址和密钥。修改不会影响已有记录。">
        <div className="flex flex-col gap-4">
          <div className="grid gap-1.5"><Label htmlFor="ai-base">API Base URL</Label><Input id="ai-base" type="url" value={base} disabled={busy === "save"} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false} onChange={e => { changeConnection(); setBase(e.target.value); if (e.target.value !== saved.base) setEditingKey(true); }} /><p className="text-[11px] text-muted-foreground">通常以 /v1 结尾，不要包含 /chat/completions。</p></div>
          <div className="grid gap-1.5"><Label htmlFor="ai-key" className="flex items-center gap-1.5"><KeyRound className="size-3.5" />API Key{saved.hasKey && <Pill tone="green">已保存</Pill>}</Label>
            {saved.hasKey && !editingKey ? <div className="flex gap-2"><Input id="ai-key" readOnly value="••••••••••••••••" className="font-mono" /><Button variant="outline" disabled={busy === "save"} onClick={() => setEditingKey(true)}>更换</Button></div>
              : <div className="flex gap-2"><Input id="ai-key" type="password" value={apiKey} disabled={busy === "save"} placeholder="填写新的 API Key" autoComplete="new-password" spellCheck={false} onChange={e => { changeConnection(); setKey(e.target.value); }} />
                {saved.hasKey && base === saved.base && <Button variant="ghost" onClick={() => { changeConnection(); setKey(""); setEditingKey(false); }}>取消</Button>}</div>}
            <p className="text-[11px] text-muted-foreground">密钥加密保存在服务器，这里只显示掩码。更换地址时需要同时填写新密钥。</p></div>
          <div className="grid gap-1.5"><Label htmlFor="tavily-key" className="flex items-center gap-1.5"><Wifi className="size-3.5" />Tavily Web Search Key{saved.hasTavilyKey && <Pill tone="green">已配置</Pill>}</Label>
            {saved.hasTavilyKey && !editingTavilyKey ? <div className="flex gap-2"><Input id="tavily-key" readOnly value="••••••••••••••••" className="font-mono" /><Button variant="outline" disabled={busy === "save"} onClick={() => setEditingTavilyKey(true)}>更换</Button></div>
              : <div className="flex gap-2"><Input id="tavily-key" type="password" value={tavilyApiKey} disabled={busy === "save"} placeholder="可选：填写 Tavily API Key" autoComplete="new-password" spellCheck={false} onChange={e => { changeConnection(); setTavilyKey(e.target.value); }} />
                {saved.hasTavilyKey && <Button variant="ghost" onClick={() => { changeConnection(); setTavilyKey(""); setEditingTavilyKey(false); }}>取消</Button>}</div>}
            <p className="text-[11px] text-muted-foreground">配置后，AI 可按需搜索实时网页；搜索结果会显示来源链接。</p></div>
          <div><Button variant="outline" size="sm" disabled={!!busy || !base.trim()} onClick={() => void run("models")}>{busy === "models" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}读取模型列表</Button></div>
        </div>
      </Panel>
      <Panel title="模型">
        <div className="flex flex-col gap-4">
          {models.length > 0 && <div className="flex flex-col gap-2"><Input aria-label="搜索模型" placeholder="搜索模型…" value={search} onChange={e => setSearch(e.target.value)} />
            <div className="max-h-48 overflow-y-auto rounded-lg border">{filtered.map(id => <button key={id} onClick={() => { setModel(id); setNotice(""); }} className={"flex w-full items-center justify-between px-3 py-1.5 text-left font-mono text-xs hover:bg-muted " + (model === id ? "bg-accent text-accent-foreground" : "")}>{id}{model === id && <Check className="size-3.5" />}</button>)}
              {!filtered.length && <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的模型</p>}</div></div>}
          <div className="grid gap-1.5"><Label htmlFor="ai-model">模型 ID</Label><Input id="ai-model" value={model} disabled={!!busy} placeholder="从列表选择，或手动填写" autoComplete="off" spellCheck={false} className="font-mono" onChange={e => { setModel(e.target.value); setNotice(""); }} /></div>
          <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!!busy || !base.trim() || !model.trim()} onClick={() => void run("test")}>{busy === "test" ? <LoaderCircle className="animate-spin" /> : <Wifi />}测试连接</Button><span className="text-xs text-muted-foreground">发送一条简短测试消息，不会发送任何记录或截图。</span></div>
        </div>
      </Panel>
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="text-sm text-muted-foreground">{dirty ? "有未保存的修改" : "已是最新配置"}</span>
        <Button disabled={!!busy || !dirty || !base.trim() || !model.trim()} onClick={() => void run("save")}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}保存</Button>
      </div>
      <p className="text-xs text-muted-foreground">保存后，聊天内容、截图和相关记录会发送给所选的 API 服务处理。</p>
    </>}
  </div>;
}
