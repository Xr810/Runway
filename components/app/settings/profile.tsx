"use client";
import { useEffect, useRef, useState } from "react";
import { Download, FileText, LoaderCircle, Save, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type EvaluationProfile } from "@/lib/enrichment-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { readJson, postJson } from "../store";
import { useAssistantPanel } from "../assistant-panel-context";
import { useNavigationGuard } from "../navigation-guard-context";
import { enrichmentRequest } from "../evaluation";
import { Panel, stamp } from "../ui";

const fields = [
  { key: "background", label: "背景摘要", rows: 6, max: 20000, placeholder: "专业、学历、技能、项目、经历。上传简历后可以只写简历里没有的内容。" },
  { key: "goals", label: "职业目标", rows: 4, max: 10000, placeholder: "想探索的岗位方向、想锻炼的能力、长期目标。" },
  { key: "preferences", label: "偏好与硬性条件", rows: 4, max: 10000, placeholder: "地点、可实习的起止时间、每周天数、工作许可、不能接受的条件。" },
] as const;
const suggestions = ["量化研究", "量化交易", "数据科学", "机器学习", "软件工程", "产品经理", "投资银行", "咨询"];

export default function ProfileSettings() {
  const { askAssistant } = useAssistantPanel();
  const { setGuard } = useNavigationGuard();
  const [profile, setProfile] = useState<EvaluationProfile | null>(null), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState(""), [target, setTarget] = useState(""), [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async () => { try { setProfile((await enrichmentRequest()).profile); setDirty(false); } catch (e) { setError((e as Error).message); } };
  useEffect(() => { let active = true; enrichmentRequest().then(r => { if (active) setProfile(r.profile); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  useEffect(() => { setGuard(dirty ? "个人背景还没保存，确定离开吗？" : null); return () => setGuard(null); }, [dirty, setGuard]);
  const change = (patch: Partial<EvaluationProfile>) => { if (profile) { setProfile({ ...profile, ...patch }); setDirty(true); } };
  async function save() {
    if (!profile) return; setBusy(true); setError("");
    try { setProfile(await enrichmentRequest({ action: "profile", profile })); setDirty(false); toast.success("已保存，岗位评估和自动扫描会用上新的背景"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function extractCv() {
    setUploading(true); setError("");
    try {
      const result = await postJson<{ profile: EvaluationProfile }>("/api/profile/cv", { action: "extract" });
      setProfile(result.profile); setDirty(false); toast.success("已根据简历填充空白背景信息");
    } catch (e) { setError("简历已保存，但 AI 提取未完成：" + (e as Error).message); }
    finally { setUploading(false); }
  }
  async function uploadCv(file: File) {
    if (dirty && !window.confirm("上传简历会先放弃还没保存的修改，继续吗？")) return;
    setUploading(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const result = await readJson<{ cv: { chars: number } }>(await fetch("/api/profile/cv", { method: "POST", body: form }));
      toast.success(`简历已解析，读到 ${result.cv.chars} 个字符`); await load(); await extractCv();
    } catch (e) { setError((e as Error).message); } finally { setUploading(false); }
  }
  async function removeCv() {
    if (!window.confirm("删除已上传的简历？")) return;
    try { await postJson("/api/profile/cv", { action: "remove" }); toast.success("已删除简历"); await load(); } catch (e) { setError((e as Error).message); }
  }
  function addTarget(value: string) {
    const v = value.trim(); if (!v || !profile || profile.targets.includes(v)) { setTarget(""); return; }
    change({ targets: [...profile.targets, v].slice(0, 30) }); setTarget("");
  }
  return <div className="flex flex-col gap-5">
    <div><h2 className="text-lg font-semibold">个人背景</h2><p className="mt-1 text-sm text-muted-foreground">岗位评估、自动扫描和 AI 助手都会参考这里。只填你愿意交给 AI 服务的内容。</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-400/10 dark:text-red-300">{error}</p>}
    {!profile ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在读取…</div> : <>
      <Panel title="简历" description="支持 PDF、Word（.docx）、Markdown、纯文本，最大 5 MB。服务器会提取文字，原文件可以随时下载或删除。">
        <input ref={fileRef} type="file" hidden accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadCv(f); e.target.value = ""; }} />
        {profile.cv ? <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
          <FileText className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{profile.cv.name}</p><p className="text-xs text-muted-foreground">{Math.max(1, Math.round(profile.cv.size / 1024))} KB · 读到 {profile.cv.chars} 个字符 · {stamp(profile.cv.uploadedAt)} 上传</p></div>
          <Button size="icon-sm" variant="ghost" asChild><a href="/api/profile/cv" aria-label="下载简历"><Download /></a></Button>
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}替换</Button>
          <Button size="icon-sm" variant="ghost" aria-label="删除简历" onClick={() => void removeCv()}><Trash2 /></Button>
        </div> : <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void uploadCv(f); }}
          className={cn("flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-7 text-sm text-muted-foreground transition-colors hover:border-primary/40", dragging && "border-primary bg-accent/50")}>
          {uploading ? <LoaderCircle className="size-5 animate-spin" /> : <Upload className="size-5" />}<span className="font-medium text-foreground">{uploading ? "正在解析…" : "上传简历"}</span><span className="text-xs">点击选择，或把文件拖到这里</span>
        </button>}
        {profile.cvText && <div className="mt-3 flex items-center justify-between gap-3"><details className="text-xs"><summary className="cursor-pointer text-muted-foreground">查看读到的文字</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 font-sans whitespace-pre-wrap">{profile.cvText.slice(0, 5000)}{profile.cvText.length > 5000 ? "\n…" : ""}</pre></details><Button size="sm" variant="outline" disabled={uploading} onClick={() => void extractCv()}>{uploading ? <LoaderCircle className="animate-spin" /> : <Sparkles />}AI 提取信息</Button></div>}
      </Panel>
      <Panel title="期待的求职领域" description="自动扫描按这些方向挑岗位；AI 助手和岗位评估也会参考。">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">{profile.targets.map(t => <span key={t} className="inline-flex h-7 items-center gap-1 rounded-full bg-accent pr-1 pl-3 text-sm text-accent-foreground">{t}<button aria-label={"移除 " + t} className="rounded-full p-0.5 hover:bg-primary/10" onClick={() => change({ targets: profile.targets.filter(x => x !== t) })}><X className="size-3" /></button></span>)}
            {!profile.targets.length && <span className="text-sm text-muted-foreground">还没有设置。</span>}</div>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); addTarget(target); }}><Input aria-label="添加求职领域" placeholder="输入领域后回车，例如：量化研究" maxLength={60} value={target} onChange={e => setTarget(e.target.value)} /><Button type="submit" variant="outline" disabled={!target.trim()}>添加</Button></form>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">常见：{suggestions.filter(s => !profile.targets.includes(s)).map(s => <button key={s} className="rounded-full border px-2 py-0.5 hover:border-primary/40 hover:text-foreground" onClick={() => addTarget(s)}>{s}</button>)}</div>
          <button className="self-start text-xs text-primary hover:underline" onClick={() => askAssistant("根据我的简历和背景，帮我梳理适合的求职方向，并更新到期待的求职领域")}><Sparkles className="mr-1 inline size-3" />让 AI 根据简历帮我梳理方向</button>
        </div>
      </Panel>
      <Panel title="补充说明">
        <div className="flex flex-col gap-5">{fields.map(f => <div key={f.key} className="grid gap-1.5"><Label htmlFor={"pf-" + f.key}>{f.label}</Label>
          <Textarea id={"pf-" + f.key} rows={f.rows} maxLength={f.max} disabled={busy} placeholder={f.placeholder} value={profile[f.key]} onChange={e => change({ [f.key]: e.target.value })} /></div>)}</div>
      </Panel>
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="text-sm text-muted-foreground">{dirty ? "有未保存的修改" : "已保存"}</span>
        <Button disabled={busy || !dirty} onClick={() => void save()}>{busy ? <LoaderCircle className="animate-spin" /> : <Save />}保存</Button>
      </div>
    </>}
  </div>;
}
