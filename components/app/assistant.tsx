"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUp, Check, ImagePlus, LoaderCircle, RotateCcw, Settings, Square, X } from "lucide-react";
import type { AgentRunReply } from "@/lib/agent-runtime-contract";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDesk, readJson } from "./store";
import { Pill } from "./ui";
import { assistantCacheDatabase } from "./assistant-cache";
type Picture = { id: string; name: string; original: string; dataUrl: string };
type Message = { id: string; role: "user" | "assistant"; text: string; images?: Picture[]; runId?: string; run?: AgentRunReply };
type Capability = { module: string; label: string; operations: string[]; fields: string[] };
type RunSummary = { id: string; status: string; prompt: string; error: string };
async function chatCache(userId: string, value?: Message[]): Promise<Message[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(assistantCacheDatabase(userId), 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chat");
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("chat", value ? "readwrite" : "readonly");
      const request = value ? tx.objectStore("chat").put(value, "messages") : tx.objectStore("chat").get("messages");
      tx.oncomplete = () => resolve(value || request.result || []); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
function fileData(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error("图片读取失败")); reader.readAsDataURL(file); }); }
async function readPicture(file: File): Promise<Picture> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("支持 PNG、JPEG 和 WebP 截图，请先转换其他格式。");
  if (file.size > 8 * 1024 * 1024 || !file.size) throw Error("每张原图需小于 8 MB。");
  const original = await fileData(file);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50000000) throw Error("图片尺寸过大，请裁剪后发送。");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d"); if (!context) throw Error("浏览器无法处理图片");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", .88);
    if (dataUrl.length > 1500000) dataUrl = canvas.toDataURL("image/jpeg", .66);
    if (dataUrl.length > 1500000) throw Error("截图内容过多，请裁剪成多张图片。");
    return { id: crypto.randomUUID(), name: file.name.slice(0, 180), original, dataUrl };
  } finally { bitmap.close(); }
}
const fieldNames: Record<string, string> = { appointments: "面试 / 笔试日程", extra: "自定义字段", archived: "归档状态", payments: "收入记录", enabled: "启用", time: "时间", maxAddPerWatch: "每次最多加入", model: "模型", cvText: "简历文字", background: "个人背景", goals: "职业目标", targets: "求职方向", preferences: "偏好", day: "日期", done: "完成状态", item: "目录资料", jdStatus: "JD 存档状态", applicationChannel: "投递渠道", applicationUrl: "投递链接", progress: "比赛进度", title: "名称", organization: "公司 / 主办方", kind: "类型", status: "状态", location: "工作地点", workMode: "工作模式", employmentType: "岗位类型", schedule: "工作时间", companyType: "公司类型", companyBasis: "分类依据", companySource: "依据链接", url: "原始链接", deadline: "截止日期", applied: "投递日期", followUp: "跟进日期", nextAction: "下一步", salary: "薪资 / 奖励", priority: "优先级", summary: "摘要", jd: "原文摘录", notes: "备注", fit: "匹配度", career: "职业发展", outlook: "公司前景" };

export default function Assistant({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { selected, assistantOpen: open, setAssistantOpen, reload, reloadReminders, applyAiFilter, aiFilter, takePrefill, assistantPrefill } = useDesk();
  const [messages, setMessages] = useState<Message[]>([]), [text, setText] = useState(""), [pictures, setPictures] = useState<Picture[]>([]);
  const [ready, setReady] = useState(false), [pending, setPending] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState("");
  const [model, setModel] = useState(""), [configured, setConfigured] = useState(true), [working, setWorking] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]), [runs, setRuns] = useState<RunSummary[]>([]);
  const [allowDuplicate, setAllowDuplicate] = useState<Record<string, boolean>>({});
  const abort = useRef<AbortController | null>(null), busy = useRef(false), inputRef = useRef<HTMLTextAreaElement>(null), uploadRef = useRef<HTMLInputElement>(null), scrollRef = useRef<HTMLDivElement>(null), cacheQueue = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    chatCache(userId).then(value => { if (active) setMessages(value.slice(-40)); }).catch(() => { if (active) setError("浏览器聊天缓存不可用，可从运行记录恢复提案。"); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; abort.current?.abort(); };
  }, [userId]);
  useEffect(() => { if (ready) cacheQueue.current = cacheQueue.current.then(() => chatCache(userId, messages)).then(() => {}).catch(() => {}); }, [messages, ready, userId]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai").then(r => readJson<{ configured: boolean; model: string; capabilities: Capability[] }>(r)).then(v => { setConfigured(v.configured); setModel(v.model); setCapabilities(v.capabilities ?? []); }).catch(e => setError(e.message));
    fetch("/api/ai?runs=1").then(r => readJson<{ runs: RunSummary[] }>(r)).then(v => setRuns(v.runs)).catch(() => {});
  }, [open, pending, working]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages.length, pending]);
  function adopt(run: AgentRunReply) {
    setMessages(old => {
      const found = old.some(m => m.role === "assistant" && m.runId === run.runId);
      const message: Message = { id: run.runId, role: "assistant", text: run.reply || "运行尚未生成提案，可恢复执行。", runId: run.runId, run };
      return found ? old.map(m => m.role === "assistant" && m.runId === run.runId ? message : m) : [...old, message].slice(-40);
    });
  }
  async function loadRun(id: string) { const run = await readJson<AgentRunReply>(await fetch(`/api/ai/runs/${id}`, { cache: "no-store" })); adopt(run); return run; }
  useEffect(() => {
    if (!open || !ready) return;
    const ids = [...new Set(messages.filter(m => m.runId && (m.role === "user" ? !messages.some(a => a.role === "assistant" && a.runId === m.runId) : !m.run || m.run.runStatus !== "completed" || Object.values(m.run.outcomes).some(o => o.status === "queued"))).map(m => m.runId!))].slice(-12);
    if (!ids.length) return;
    let active = true;
    const refresh = async () => {
      for (const id of ids) { try { const run = await readJson<AgentRunReply>(await fetch(`/api/ai/runs/${id}`, { cache: "no-store" })); if (active && !busy.current) adopt(run); } catch { /* a newly sent run may not exist yet */ } }
    };
    const timer = setInterval(() => void refresh(), 5000); void refresh();
    return () => { active = false; clearInterval(timer); };
  }, [open, ready, messages.map(m => m.runId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open || !ready || !assistantPrefill) return; const p = takePrefill(); if (p?.send && configured) void send(p.text); else if (p) queueMicrotask(() => setText(p.text)); }, [open, ready, assistantPrefill, takePrefill, configured]); // eslint-disable-line react-hooks/exhaustive-deps
  async function addPictures(files: File[]) {
    if (busy.current || reading) return; setReading(true); setError("");
    try { if (pictures.length + files.length > 6) throw Error("每次最多6张截图。"); const next = await Promise.all(files.map(readPicture)); setPictures(p => [...p, ...next]); }
    catch (e) { setError((e as Error).message); } finally { setReading(false); }
  }
  async function send(override?: string) {
    const content = (override ?? text).trim(); if (busy.current || reading || !ready || !configured || (!content && !pictures.length)) return;
    const runId = crypto.randomUUID(), user: Message = { id: crypto.randomUUID(), runId, role: "user", text: content || "请识别截图，生成待确认操作。", images: pictures };
    busy.current = true; setPending(true); setError(""); setText(""); setPictures([]); setMessages(m => [...m, user].slice(-40));
    const controller = new AbortController(); abort.current = controller;
    try {
      const history = [...messages.slice(-15), user];
      const run = await readJson<AgentRunReply>(await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ runId, page: pathname, selectedEntryId: selected?.id ?? null, workspace: pathname === "/part-time" ? "part-time" : "desk", currentFilter: aiFilter ? (({ ids, ...rest }) => { void ids; return rest; })(aiFilter) : null,
          images: history.flatMap(m => m.images ?? []).slice(-6).map(({ id, name, dataUrl }) => ({ id, name, dataUrl })),
          messages: history.map(m => ({ role: m.role, text: (m.text + (m.run ? "\n网站提案与真实执行状态：" + JSON.stringify({ proposals: m.run.actions?.map(a => ({ id: a.id, title: a.title, changes: a.changes })), outcomes: m.run.outcomes }) : "")).slice(0,35000) })) }) }));
      adopt(run); setModel(run.model); if (run.filter) applyAiFilter(run.filter, run.matchIds);
    } catch (e) { setError(controller.signal.aborted ? "已停止等待，可从运行记录查看或恢复；写入仍需确认。" : (e as Error).message); }
    finally { busy.current = false; setPending(false); abort.current = null; }
  }
  async function decide(runId: string, proposalId?: string, approved = false) {
    if (busy.current) return; busy.current = true; setWorking(proposalId ?? runId); setError("");
    try {
      const run = await readJson<AgentRunReply>(await fetch(`/api/ai/runs/${runId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(proposalId ? { action: "decide", decision: { proposalId, approved, allowDuplicate: !!allowDuplicate[proposalId] } } : { action: "recover" }) }));
      adopt(run); await reload(); await reloadReminders(); window.dispatchEvent(new Event("runway:part-time-changed"));
    } catch (e) { setError((e as Error).message); } finally { busy.current = false; setWorking(null); }
  }
  if (!open) return null;
  const disabled = pending || !!working;
  return <aside aria-label="AI 助手" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l bg-card shadow-xl" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addPictures(Array.from(e.dataTransfer.files)); }}>
    <header className="flex items-center gap-2 border-b px-4 py-3"><div className="flex-1"><p className="font-semibold">Runway 助手</p><p className="text-xs text-muted-foreground">{model || "配置模型后开始"}</p></div>
      <Button variant="ghost" size="icon-sm" aria-label="新对话" disabled={disabled} onClick={() => { if (window.confirm("清空本机聊天？服务端提案仍可在运行记录中查看。")) { setMessages([]); setPictures([]); } }}><RotateCcw /></Button>
      <Button variant="ghost" size="icon-sm" asChild><Link href="/settings" aria-label="模型设置"><Settings /></Link></Button><Button variant="ghost" size="icon-sm" aria-label="关闭 AI 助手" onClick={() => setAssistantOpen(false)}><X /></Button>
    </header>
    <div className="border-b px-4 py-2 text-xs">
      <details><summary className="cursor-pointer">可用操作 · {capabilities.length} 类</summary><div className="mt-2 max-h-48 space-y-2 overflow-auto">{capabilities.map(c => <div key={c.module}><strong>{c.label}</strong><p className="text-muted-foreground">{c.operations.map(o => ({add:"新增",update:"修改",delete:"删除",restore:"恢复",void:"作废",done:"完成状态",read:"已读",dismiss:"收起",run:"运行",lock:"锁定",refresh:"刷新"}[o] ?? o)).join("、")}</p><p className="break-all text-muted-foreground">{c.fields.map(f => fieldNames[f] ?? f).join("、")}</p></div>)}</div></details>
      <details className="mt-2"><summary className="cursor-pointer">最近运行 · 恢复提案</summary><div className="mt-2 max-h-44 space-y-1 overflow-auto">{runs.map(r => <button key={r.id} className="block w-full rounded border px-2 py-1 text-left" disabled={disabled} onClick={() => void loadRun(r.id).catch(e => setError(e.message))}>{r.prompt?.slice(0,80) || "图片识别"} · {r.status === "completed" ? "已处理" : r.status === "awaiting_confirmation" ? "待确认" : "查看状态"}</button>)}</div></details>
    </div>
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
      {!messages.length && <div className="text-sm leading-relaxed"><p className="text-lg font-semibold">有什么我可以帮你？</p><p className="mt-2 text-muted-foreground">读取和管理岗位、项目、比赛、兼职收入、提醒与公司资料。所有修改先展示前后变化，确认后执行；后台任务可在这里查看结果。</p></div>}
      {messages.map(m => <div key={m.id} className={cn("flex flex-col gap-2",m.role === "user" ? "items-end" : "items-start")}>
        {!!m.images?.length && <div className="flex gap-1">{m.images.map(i => <img key={i.id} src={i.dataUrl} alt={i.name} className="size-14 rounded border object-cover" />)}</div>}
        <p className={cn("max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed", m.role === "user" && "rounded-xl bg-primary px-3 py-2 text-primary-foreground")}>{m.text}</p>
        {m.run?.pages?.map(p => <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="max-w-full truncate text-xs text-muted-foreground underline">{p.title || p.url} · {p.note}</a>)}
        {m.run?.runError && <p role="alert" className="text-xs text-red-600">{m.run.runError}</p>}
        {m.run && (!m.run.reply || m.run.runStatus === "recoverable") && <Button size="sm" disabled={disabled} onClick={() => void decide(m.runId!)}>恢复运行</Button>}
        {m.run?.actions?.map(a => { const outcome = m.run!.outcomes[a.id]; return <article key={a.id} className="w-full rounded-xl border bg-background p-3">
          <Pill tone={outcome?.status === "done" ? "green" : outcome?.status === "error" ? "red" : "violet"}>{outcome ? {done:"已完成",queued:"后台任务",rejected:"已拒绝",error:"未完成"}[outcome.status] : "待确认操作"}</Pill>
          <p className="mt-2 text-sm font-semibold">{a.title}</p>
          <details className="mt-2 text-xs"><summary className="cursor-pointer">查看修改前后</summary>{a.changes.map((c,i) => <div key={i} className="mt-2 whitespace-pre-wrap break-all"><strong>{fieldNames[c.field] ?? c.field}</strong><p>修改前：{typeof c.before === "string" ? c.before || "（空）" : JSON.stringify(c.before)}</p><p>修改后：{typeof c.after === "string" ? c.after || "（空）" : JSON.stringify(c.after)}</p></div>)}</details>
          {!!a.sourceImageIds?.length && <p className="mt-2 text-xs text-muted-foreground">确认后保存 {a.sourceImageIds.length} 张处理后的来源截图。</p>}
          {!!a.warnings?.length && <div className="mt-2 text-xs text-amber-700">{a.warnings.join("；")}<label className="mt-1 flex gap-1"><input type="checkbox" checked={!!allowDuplicate[a.id]} disabled={disabled || !!outcome} onChange={e => setAllowDuplicate(v => ({...v,[a.id]:e.target.checked}))} />已核对，仍然新增</label></div>}
          {outcome && <p className="mt-2 text-xs" role="status">{outcome.message}{outcome.status === "error" ? " 请根据当前记录重新生成提案。" : ""}</p>}
          {outcome?.status === "error" && a.path === "/api/companies/complete" && <Button size="sm" variant="outline" className="mt-2" disabled={disabled} onClick={() => void send("重新补全公司目录里缺失的官网和官方图标")}>重试公司资料补全</Button>}
          {!outcome && <div className="mt-3 flex gap-2"><Button size="sm" disabled={disabled || !!a.warnings?.length && !allowDuplicate[a.id]} onClick={() => void decide(m.runId!,a.id,true)}>{working === a.id ? <LoaderCircle className="animate-spin" /> : <Check />}确认执行</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => void decide(m.runId!,a.id,false)}>拒绝</Button></div>}
        </article>; })}
        {m.run?.filter && <Button variant="outline" size="sm" onClick={() => applyAiFilter(m.run!.filter!,m.run!.matchIds)}>{m.run.filter.label} · {m.run.matchCount} 条</Button>}
        {m.role === "user" && m.runId && !messages.some(a => a.role === "assistant" && a.runId === m.runId) && !pending && <Button variant="outline" size="sm" disabled={disabled} onClick={() => void loadRun(m.runId!).catch(e => setError(e.message))}>查看运行状态</Button>}
      </div>)}
      {pending && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取资料并生成提案…</p>}
    </div>
    <div className="border-t p-3">
      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
      {!configured && <Link href="/settings" className="text-xs underline">请先配置模型</Link>}
      <div className="mb-2 flex gap-1">{pictures.map(p => <button key={p.id} disabled={disabled} onClick={() => setPictures(v => v.filter(i=>i.id!==p.id))} title="移除截图"><img src={p.dataUrl} alt={p.name} className="size-12 rounded object-cover" /></button>)}</div>
      <form onSubmit={e => {e.preventDefault();void send();}} className="rounded-xl border bg-background p-2">
        <textarea ref={inputRef} value={text} onChange={e=>setText(e.target.value)} disabled={disabled} rows={2} maxLength={8000} className="w-full resize-none bg-transparent p-1 text-sm outline-none" aria-label="给 AI 助手发消息" placeholder="说明要查询或修改什么，或粘贴截图…" onPaste={e => {const files=Array.from(e.clipboardData.files);if(files.length){e.preventDefault();void addPictures(files);}}} onKeyDown={e => {if(e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing){e.preventDefault();void send();}}} />
        <div className="flex justify-between"><Button type="button" variant="ghost" size="icon-sm" disabled={disabled || reading} aria-label="添加截图" onClick={()=>uploadRef.current?.click()}><ImagePlus /></Button>{pending ? <Button type="button" size="icon-sm" aria-label="停止生成" onClick={()=>abort.current?.abort()}><Square /></Button> : <Button type="submit" size="icon-sm" aria-label="发送" disabled={disabled || reading || !configured || (!text.trim() && !pictures.length)}><ArrowUp /></Button>}</div>
      </form><input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={e=>{void addPictures(Array.from(e.target.files ?? []));e.target.value="";}} />
    </div>
  </aside>;
}
