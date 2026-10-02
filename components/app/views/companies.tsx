"use client";
import { useState } from "react";
import { ArrowUpRight, Building2, Check, ExternalLink, Globe, ImageIcon, LoaderCircle, Pencil, Plus, Radar, Search, SearchCode } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { type Entry, employmentTypes, schedules, workModes } from "@/lib/model";
import { allChannels, channelSchema, companyProfileSchema, groupCompanies, identity, isApplied } from "@/lib/journey";
import { blankWatch, watchSchema, type CompanyWatch } from "@/lib/watches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDesk, postJson } from "../store";
import { enrichmentRequest, useEnrichment } from "../evaluation";
import { AutomationMenu, ScanStatus, useScan } from "../scan";
import { CompanyMark, EmptyState, PageHeader, Pill, Segmented, StatusBadge } from "../ui";

type Editor = { type: "company" | "channel"; name: string; url: string; logoUrl: string; existing: boolean };
type Selection = { type: "company" | "channel"; key: string } | null;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const watchFilters = [
  { key: "workModes", label: "工作模式", options: workModes },
  { key: "employmentTypes", label: "岗位类型", options: employmentTypes },
  { key: "schedules", label: "工作时间", options: schedules },
] as const;

export default function CompaniesView() {
  const { data, reload, logoFor, brandLogos, openEvaluation } = useDesk();
  useEnrichment();
  const scan = useScan();
  const [tab, setTab] = useState<"companies" | "boards" | "channels">("companies"), [query, setQuery] = useState(""), [onlyTracked, setOnlyTracked] = useState(false);
  const [selected, setSelected] = useState<Selection>(null), [editor, setEditor] = useState<Editor | null>(null), [tracking, setTracking] = useState<CompanyWatch | null>(null), [busy, setBusy] = useState(false);
  const { directory, watches } = data;
  const jobs = data.entries.filter(e => e.kind === "job"), companies = groupCompanies(jobs);
  for (const name of [...directory.companies.map(c => c.name), ...watches.filter(w => w.kind === "company").map(w => w.company)]) if (!companies.some(c => c.key === identity(name))) companies.push({ key: identity(name), name, entries: [] });
  const channels = allChannels(jobs, directory), unassigned = jobs.filter(e => !e.applicationChannel);
  const watchesOf = (name: string) => watches.filter(w => w.kind === "company" && identity(w.company) === identity(name)), boards = watches.filter(w => w.kind === "board");
  const lastRun = (id: string) => scan.overview?.lastRuns[id];
  const tracked = (name: string) => watchesOf(name).some(w => w.enabled);
  const profile = (name: string) => { const saved = directory.companies.find(c => identity(c.name) === identity(name)); return { website: saved?.website ?? "", logoUrl: saved?.logoUrl ?? "" }; };
  const channelLogo = (c: { name: string; url: string; logoUrl: string }) => c.logoUrl || brandLogos["channel:" + identity(c.name)] || (c.url ? new URL("/favicon.ico", c.url).href : "");
  const q = query.trim().toLowerCase();
  const shownCompanies = companies.filter(c => c.name.toLowerCase().includes(q) && (!onlyTracked || tracked(c.name)));
  const shownChannels = channels.filter(c => c.name.toLowerCase().includes(q));

  async function saveTracking(watch: CompanyWatch) {
    const parsed = watchSchema.safeParse(watch); if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    setBusy(true);
    try { await postJson("/api/watches", { action: "save", watch: parsed.data }); setTracking(null); toast.success(watch.enabled ? `已保存。每天 ${scan.overview?.settings.time ?? "08:00"} 自动扫描时会检查，也可以立即扫描` : "已暂停，链接和条件都会保留"); }
    catch (e) { toast.error((e as Error).message); } finally { await reload(); setBusy(false); }
  }
  async function saveProfile() {
    if (!editor) return;
    const parsed = editor.type === "company" ? companyProfileSchema.safeParse({ name: editor.name, website: editor.url, logoUrl: editor.logoUrl }) : channelSchema.safeParse({ name: editor.name, url: editor.url, logoUrl: editor.logoUrl });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!editor.existing && (editor.type === "channel" ? channels : companies).some(c => identity(c.name) === identity(editor.name))) { toast.error("已经有同名的项目了，请直接编辑它"); return; }
    setBusy(true);
    try {
      const next = editor.type === "company"
        ? { ...directory, companies: [...directory.companies.filter(c => identity(c.name) !== identity(editor.name)), companyProfileSchema.parse(parsed.data)] }
        : { ...directory, channels: [...directory.channels.filter(c => identity(c.name) !== identity(editor.name)), channelSchema.parse(parsed.data)] };
      await postJson("/api/directory", { action: "save", directory: next }); setEditor(null); toast.success("已保存");
    } catch (e) { toast.error((e as Error).message); } finally { await reload(); setBusy(false); }
  }
  async function uploadLogo(file: File) {
    if (!editor) return; if (file.size > 512 * 1024) { toast.error("图片需小于 512 KB"); return; }
    setBusy(true);
    try {
      const imageDataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(Error("图片读取失败")); r.readAsDataURL(file); });
      const result = await enrichmentRequest({ imageDataUrl }, "/api/enrichment/upload");
      setEditor(c => c ? { ...c, logoUrl: result.url } : null); toast.success("图片已上传，保存后生效");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const company = selected?.type === "company" ? companies.find(c => c.key === selected.key) : undefined;
  const channel = selected?.type === "channel" ? channels.find(c => identity(c.name) === selected.key) : undefined;
  const selectedJobs = company?.entries ?? (selected?.type === "channel" ? jobs.filter(e => selected.key === "__unknown" ? !e.applicationChannel : identity(e.applicationChannel) === selected.key) : []);

  return <>
    <PageHeader title="公司" description="岗位按公司自动归类。没投递过的公司也可以先加进来，设置招聘追踪。"
      actions={<><AutomationMenu scan={scan} /><Button onClick={() => tab === "boards" ? setTracking(blankWatch("board")) : setEditor({ type: tab === "companies" ? "company" : "channel", name: "", url: "", logoUrl: "", existing: false })}><Plus />{tab === "companies" ? "添加公司" : tab === "boards" ? "关注招聘网站" : "添加渠道"}</Button></>}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Segmented value={tab} onChange={v => { setTab(v); setSelected(null); }} options={[{ value: "companies", label: <><Building2 />公司</>, count: companies.length }, { value: "boards", label: <><SearchCode />招聘网站</>, count: boards.length }, { value: "channels", label: <><Globe />投递渠道</>, count: channels.length }]} />
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索" placeholder={tab === "companies" ? "搜索公司…" : "搜索渠道…"} className="h-8 bg-card pl-8" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {tab === "companies" && <label className="flex items-center gap-2 text-[13px] text-muted-foreground"><Switch checked={onlyTracked} onCheckedChange={setOnlyTracked} />只看追踪中</label>}
      </div>
    </PageHeader>

    {tab === "companies" ? (shownCompanies.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shownCompanies.map(c => { const applied = c.entries.filter(isApplied).length, site = profile(c.name).website; return <button key={c.key} onClick={() => setSelected({ type: "company", key: c.key })}
      className="group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40">
      <div className="flex items-start gap-3"><CompanyMark name={c.name} src={logoFor(c.name)} size="lg" />
        <div className="min-w-0 flex-1"><p className="truncate font-semibold group-hover:text-primary">{c.name}</p><p className="truncate text-xs text-muted-foreground">{host(site) || "未设置官网"}</p></div>
        {tracked(c.name) ? <Pill tone="green"><Radar className="size-3" />追踪中</Pill> : watchesOf(c.name).length ? <Pill>已暂停</Pill> : null}</div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground"><span><b className="tabular text-sm font-semibold text-foreground">{c.entries.length}</b> 个岗位</span><span><b className="tabular text-sm font-semibold text-foreground">{applied}</b> 个已投递</span></div>
      {c.entries.length > 0 && <div className="flex flex-wrap gap-1">{[...new Set(c.entries.map(e => e.status))].slice(0, 3).map(s => <StatusBadge key={s} status={s} />)}</div>}
      {watchesOf(c.name)[0] && <ScanStatus run={lastRun(watchesOf(c.name)[0].id)} className="truncate" />}
    </button>; })}</div>
      : <EmptyState icon={<Building2 />} title={companies.length ? "没有匹配的公司" : "还没有公司"} description={companies.length ? "换个关键词，或关闭「只看追踪中」。" : "添加岗位后会自动归类到公司，也可以先手动添加想关注的公司。"} />)
      : tab === "boards" ? <>
        <p className="mb-3 text-xs text-muted-foreground">关注招聘网站上的搜索结果页（例如按关键词和地区筛好的 JobsDB、LinkedIn 列表）。自动扫描会按你的求职方向挑出合适的岗位加入。部分网站会拒绝自动访问，扫描结果里会写明原因。</p>
        {boards.length ? <div className="grid gap-3 lg:grid-cols-2">{boards.filter(b => b.company.toLowerCase().includes(q)).map(b => <article key={b.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-start gap-3"><span className="inline-flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground"><SearchCode className="size-4" /></span>
            <div className="min-w-0 flex-1"><p className="truncate font-semibold">{b.company}</p><a href={b.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-primary hover:underline">{host(b.url)}<ExternalLink className="size-3 shrink-0" /></a></div>
            <Switch checked={b.enabled} disabled={busy} aria-label={"关注 " + b.company} onCheckedChange={v => void saveTracking({ ...b, enabled: v })} /></div>
          <p className="text-xs text-muted-foreground">{[b.keywords && "包含：" + b.keywords, b.excludeKeywords && "排除：" + b.excludeKeywords, b.locations.join("、"), [...b.employmentTypes, ...b.workModes].join(" · ")].filter(Boolean).join(" · ") || "没有额外条件，按你的求职方向筛选"}</p>
          <div className="flex items-center justify-between gap-2 border-t pt-3"><ScanStatus run={lastRun(b.id)} className="min-w-0 truncate" />
            <div className="flex shrink-0 gap-1"><Button size="xs" variant="ghost" onClick={() => setTracking({ ...b })}><Pencil />条件</Button><Button size="xs" variant="outline" disabled={scan.busy} onClick={() => void scan.run([b.id])}><Radar />扫描</Button></div></div>
        </article>)}</div>
          : <EmptyState icon={<SearchCode />} title="还没有关注招聘网站" description="在 JobsDB、LinkedIn 等网站按关键词和地区搜索后，把结果页链接加进来。" action={<Button size="sm" onClick={() => setTracking(blankWatch("board"))}><Plus />关注招聘网站</Button>} />}
      </>
      : <>
        <p className="mb-3 text-xs text-muted-foreground">渠道是你实际投递的方式（官网、Indeed、JobsDB…），和岗位的原始链接分开记录。</p>
        {shownChannels.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shownChannels.map(c => { const count = jobs.filter(e => identity(e.applicationChannel) === identity(c.name)).length; return <button key={c.name} onClick={() => setSelected({ type: "channel", key: identity(c.name) })}
          className="group flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/40">
          {c.name === "公司官网" ? <span className="inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border ring-inset"><Building2 className="size-5" /></span> : <CompanyMark name={c.name} src={channelLogo(c)} size="lg" />}
          <div className="min-w-0 flex-1"><p className="truncate font-semibold group-hover:text-primary">{c.name}</p><p className="truncate text-xs text-muted-foreground">{host(c.url) || (c.name === "公司官网" ? "直接在公司网站投递" : "未设置网址")}</p></div>
          <span className="tabular text-sm font-semibold">{count}<span className="ml-0.5 text-xs font-normal text-muted-foreground">个</span></span>
        </button>; })}</div> : <EmptyState icon={<Globe />} title="没有匹配的渠道" />}
        {unassigned.length > 0 && <button onClick={() => setSelected({ type: "channel", key: "__unknown" })} className="mt-4 flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-sm hover:border-primary/40">
          <span className="text-muted-foreground"><b className="tabular font-semibold text-foreground">{unassigned.length}</b> 个岗位还没填投递渠道</span><span className="ml-auto inline-flex items-center gap-1 text-primary">去补充<ArrowUpRight className="size-4" /></span></button>}
      </>}

    <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {selected && <>
          <div className="border-b px-6 pt-6 pb-4">
            <div className="flex items-center gap-3 pr-8">
              {company ? <CompanyMark name={company.name} src={logoFor(company.name)} size="lg" /> : <span className="inline-flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Globe className="size-5" /></span>}
              <div className="min-w-0"><SheetTitle className="truncate text-lg">{company?.name || channel?.name || "未填写渠道"}</SheetTitle>
                <SheetDescription>{selectedJobs.length} 个岗位 · {selectedJobs.filter(isApplied).length} 个已投递</SheetDescription></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {company && <><Button size="sm" variant="outline" onClick={() => { const p = profile(company.name); setEditor({ type: "company", name: company.name, url: p.website, logoUrl: p.logoUrl, existing: true }); }}><Pencil />公司资料</Button>
                <Button size="sm" variant="outline" onClick={() => openEvaluation({ kind: "company", id: company.key })}><ImageIcon />图标来源</Button>
                {profile(company.name).website && <Button size="sm" variant="ghost" asChild><a href={profile(company.name).website} target="_blank" rel="noreferrer">官网<ExternalLink /></a></Button>}</>}
              {channel && <><Button size="sm" variant="outline" onClick={() => setEditor({ type: "channel", name: channel.name, url: channel.url, logoUrl: channel.logoUrl, existing: true })}><Pencil />编辑渠道</Button>
                {channel.name !== "公司官网" && <Button size="sm" variant="outline" onClick={() => openEvaluation({ kind: "channel", id: identity(channel.name) })}><ImageIcon />图标来源</Button>}
                {channel.url && <Button size="sm" variant="ghost" asChild><a href={channel.url} target="_blank" rel="noreferrer">打开<ExternalLink /></a></Button>}</>}
            </div>
          </div>
          <div className="flex flex-col gap-7 px-6 py-6">
            {company && <section>
              <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold"><Radar className="size-4 text-muted-foreground" />招聘追踪</h3>
                {!watchesOf(company.name).length && <Button size="sm" variant="outline" onClick={() => setTracking({ ...blankWatch(), company: company.name })}><Plus />开始追踪</Button>}</div>
              <p className="mb-3 text-xs text-muted-foreground">每天自动扫描这里的招聘页，按你的求职方向和下面的条件挑出合适的岗位加入。Muse 也会读取这些设置。</p>
              {watchesOf(company.name).map(w => <div key={w.id} className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
                <div className="min-w-0 flex-1 text-xs"><a href={w.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-sm text-primary hover:underline">{host(w.url)}<ExternalLink className="size-3" /></a>
                  <p className="mt-1 text-muted-foreground">{w.locations.join("、") || "地点不限"} · {[...w.employmentTypes, ...w.workModes, ...w.schedules].join(" · ") || "类型不限"}</p>
                  {w.keywords && <p className="mt-0.5 text-muted-foreground">包含：{w.keywords}</p>}{w.excludeKeywords && <p className="mt-0.5 text-muted-foreground">排除：{w.excludeKeywords}</p>}</div>
                <div className="flex flex-col items-end gap-2"><label className="flex items-center gap-2 text-xs text-muted-foreground">{w.enabled ? "追踪中" : "已暂停"}<Switch checked={w.enabled} disabled={busy} aria-label={"追踪 " + company.name} onCheckedChange={v => void saveTracking({ ...w, enabled: v })} /></label>
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => setTracking({ ...w })}><Pencil />条件</Button>
                  <Button size="xs" variant="outline" disabled={scan.busy} onClick={() => void scan.run([w.id])}><Radar />立即扫描</Button></div>
                <ScanStatus run={lastRun(w.id)} className="basis-full" />
              </div>)}
            </section>}
            <section>
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">岗位</h3>
                {company && <AddJob organization={company.name} onDone={() => setSelected(null)} />}</div>
              {selected.key === identity("公司官网") ? <div className="flex flex-col gap-2">{groupCompanies(selectedJobs).map(g => <button key={g.key} className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left hover:border-primary/40" onClick={() => { setTab("companies"); setSelected({ type: "company", key: g.key }); }}>
                <CompanyMark name={g.name} src={logoFor(g.name)} size="sm" /><span className="flex-1 text-sm font-medium">{g.name}</span><span className="text-xs text-muted-foreground">{g.entries.length} 个岗位</span><ArrowUpRight className="size-4 text-muted-foreground" /></button>)}</div>
                : <JobList entries={selectedJobs} onOpen={() => setSelected(null)} />}
              {!selectedJobs.length && <p className="text-sm text-muted-foreground">{company ? "还没有这家公司的岗位。" : "还没有岗位使用这个渠道。在岗位编辑里选择投递渠道后会出现在这里。"}</p>}
            </section>
          </div>
        </>}
      </SheetContent>
    </Sheet>

    <Dialog open={!!editor} onOpenChange={open => { if (!open && !busy) setEditor(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editor?.type === "company" ? (editor.existing ? "公司资料" : "添加公司") : editor?.existing ? "编辑渠道" : "添加投递渠道"}</DialogTitle>
          <DialogDescription>{editor?.type === "company" ? "公司会自动关联同名的岗位。" : "保存后可以在岗位编辑里直接选择。"}</DialogDescription></DialogHeader>
        {editor && <form id="profile-form" className="grid gap-4" onSubmit={e => { e.preventDefault(); void saveProfile(); }}>
          <div className="grid gap-1.5"><Label htmlFor="d-name">名称</Label><Input id="d-name" required disabled={editor.existing} maxLength={editor.type === "channel" ? 100 : 2000} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="d-url">{editor.type === "company" ? "官网" : "网址（可选）"}</Label><Input id="d-url" type="url" placeholder="https://" value={editor.url} onChange={e => setEditor({ ...editor, url: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="d-logo">图标（可选）</Label>
            <div className="flex items-center gap-3"><CompanyMark name={editor.name || "?"} src={editor.logoUrl} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col gap-2"><Input id="d-logo" placeholder="https://… 留空则自动获取" value={editor.logoUrl} onChange={e => setEditor({ ...editor, logoUrl: e.target.value })} />
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-primary hover:underline"><ImageIcon className="size-3.5" />上传图片<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/x-icon" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} /></label></div></div>
            <p className="text-[11px] text-muted-foreground">手动设置的图标优先，自动获取不会覆盖。PNG、JPEG、WebP、ICO，最大 512 KB。</p></div>
        </form>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setEditor(null)}>取消</Button><Button type="submit" form="profile-form" disabled={busy}>{busy && <LoaderCircle className="animate-spin" />}保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!tracking} onOpenChange={open => { if (!open && !busy) setTracking(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{tracking?.kind === "board" ? (tracking.revision ? "招聘网站 · " + tracking.company : "关注招聘网站") : tracking?.company + " · 追踪条件"}</DialogTitle><DialogDescription>自动扫描会读取这个页面，按你的求职方向和这些条件挑出合适的新岗位。</DialogDescription></DialogHeader>
        {tracking && <form id="watch-form" className="grid gap-4" onSubmit={e => { e.preventDefault(); void saveTracking(tracking); }}>
          {tracking.kind === "board" && <div className="grid gap-1.5"><Label htmlFor="w-name">网站名称</Label><Input id="w-name" required maxLength={200} placeholder="例如：JobsDB 香港量化实习" value={tracking.company} disabled={busy} onChange={e => setTracking({ ...tracking, company: e.target.value })} /></div>}
          <label className="flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm">{tracking.kind === "board" ? "自动扫描这个页面" : "追踪这家公司的新岗位"}<Switch checked={tracking.enabled} disabled={busy} onCheckedChange={v => setTracking({ ...tracking, enabled: v })} /></label>
          <div className="grid gap-1.5"><Label htmlFor="w-url">{tracking.kind === "board" ? "搜索结果页链接" : "招聘列表页"}</Label><Input id="w-url" required type="url" placeholder="https://公司招聘网站/职位列表" maxLength={4000} value={tracking.url} disabled={busy} onChange={e => setTracking({ ...tracking, url: e.target.value })} /><p className="text-[11px] text-muted-foreground">{tracking.kind === "board" ? "先在网站上按关键词、地区筛好，再复制结果页地址。" : "填职位列表页，不是某个岗位的详情页。Greenhouse、Lever、Ashby、Workday 等招聘系统的页面最稳定。"}</p></div>
          <div className="grid gap-1.5"><Label htmlFor="w-locations">工作地点</Label><Input id="w-locations" maxLength={2000} placeholder="香港、伦敦（英国）" value={tracking.locations.join("、")} disabled={busy} onChange={e => setTracking({ ...tracking, locations: e.target.value.split(/[、,，]/).map(v => v.trim()).filter(Boolean).slice(0, 30) })} /><p className="text-[11px] text-muted-foreground">多个实际工作地点用逗号分隔；留空表示不限。</p></div>
          {watchFilters.map(g => <div key={g.key} className="grid gap-2"><p className="flex items-center justify-between text-sm font-medium">{g.label}<span className="text-xs font-normal text-muted-foreground">{tracking[g.key].length ? `已选 ${tracking[g.key].length} 项` : "不限"}</span></p>
            <div className="flex flex-wrap gap-2">{g.options.filter(o => o !== "待核实").map(o => { const on = tracking[g.key].includes(o); return <label key={o} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", on && "border-primary/50 bg-accent text-accent-foreground")}>
              <Checkbox className="size-3.5" checked={on} disabled={busy} onCheckedChange={v => setTracking({ ...tracking, [g.key]: v === true ? [...tracking[g.key], o] : tracking[g.key].filter(x => x !== o) })} />{o}</label>; })}</div></div>)}
          <div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label htmlFor="w-kw">包含关键词</Label><Input id="w-kw" maxLength={2000} disabled={busy} value={tracking.keywords} onChange={e => setTracking({ ...tracking, keywords: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="w-ex">排除关键词</Label><Input id="w-ex" maxLength={2000} disabled={busy} value={tracking.excludeKeywords} onChange={e => setTracking({ ...tracking, excludeKeywords: e.target.value })} /></div></div>
          <div className="grid gap-1.5"><Label htmlFor="w-notes">备注</Label><Textarea id="w-notes" rows={3} maxLength={10000} disabled={busy} value={tracking.notes} onChange={e => setTracking({ ...tracking, notes: e.target.value })} /></div>
        </form>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setTracking(null)}>取消</Button><Button type="submit" form="watch-form" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}保存</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function AddJob({ organization, onDone }: { organization: string; onDone: () => void }) {
  const { newEntry } = useDesk();
  return <Button size="sm" variant="outline" onClick={() => { onDone(); newEntry("job", { organization }); }}><Plus />添加岗位</Button>;
}
function JobList({ entries, onOpen }: { entries: Entry[]; onOpen: () => void }) {
  const { openEntry } = useDesk();
  return <ul className="flex flex-col gap-2">{entries.map(e => <li key={e.id}><button onClick={() => { onOpen(); openEntry(e.id); }} className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left hover:border-primary/40">
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{e.title}</p><p className="truncate text-xs text-muted-foreground">{e.organization} · {e.applicationChannel || "渠道未填写"}{e.applied ? ` · ${e.applied} 投递` : ""}</p></div>
    <StatusBadge status={e.status} />
  </button></li>)}</ul>;
}
