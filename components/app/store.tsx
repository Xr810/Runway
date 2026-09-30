"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { type Entry, type Attachment, blankEntry, entrySchema, today } from "@/lib/model";
import { type Directory, identity } from "@/lib/journey";
import { type CompanyWatch } from "@/lib/watches";
import { type AiFilter } from "@/lib/ai-contract";
import { type EnrichmentTarget, type EvaluationWeights, weightPresets } from "@/lib/enrichment-contract";
import { type Reminder } from "@/lib/reminder-schema";
import { readJson } from "@/lib/api-response";
export { readJson } from "@/lib/api-response";

/** List rows carry everything except the JD text; `jdChars` tells how long it is. */
export type ListEntry = Entry & { jdChars?: number };
export type VersionMeta = { id: string; entry_id: string; created: string };
export type VersionFull = VersionMeta & { data: string };
export type DeskData = { entries: ListEntry[]; files: Attachment[]; versions: VersionMeta[]; watches: CompanyWatch[]; directory: Directory };
export type ReminderItem = Reminder & { description: string };
export type Reminders = { reminders: ReminderItem[]; today: (ReminderItem & { done: boolean })[] };
export type ActiveAiFilter = AiFilter & { ids: string[] | null };
export type Prefill = { text: string; send: boolean };
const emptyDirectory: Directory = { revision: 0, companies: [], channels: [] };

export async function postJson<T = Record<string, unknown>>(path: string, body: unknown, signal?: AbortSignal) {
  return readJson<T>(await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }));
}
async function fetchDesk(): Promise<DeskData> {
  const d = await readJson<Partial<DeskData> & { entries: ListEntry[]; files: Attachment[]; versions: VersionMeta[] }>(await fetch("/api/desk", { cache: "no-store" }));
  return { ...d, watches: d.watches || [], directory: d.directory || emptyDirectory };
}
export async function fetchEntry(id: string) { return readJson<{ entry: Entry; versions: VersionFull[] }>(await fetch("/api/desk?entry=" + encodeURIComponent(id), { cache: "no-store" })); }

export type Notice = { id: string; seq: string; actor: string; action: string; summary: string; entryId: string | null; title: string; organization: string; created: string; read: boolean; dismissed: boolean; source: { kind: string; id: string; subject: string; url: string; occurredAt: string }; changes: { field: string; before: unknown; after: unknown }[] };
export type NoticeFeed = { items: Notice[]; unread: number; latest: string; nextBefore: string | null };

type Ctx = {
  evaluationWeights: EvaluationWeights; setEvaluationWeights: (weights: EvaluationWeights) => void;
  data: DeskData; loading: boolean; error: string; reload: () => Promise<void>;
  saveEntry: (entry: Entry) => Promise<Entry>; patchEntry: (entry: Pick<Entry, "id" | "revision">, patch: Partial<Entry>) => Promise<Entry>;
  removeEntry: (entry: Pick<Entry, "id" | "revision" | "title">) => Promise<void>; upload: (entryId: string, file: File) => Promise<void>;
  selected: Entry | null; selectedVersions: VersionFull[]; selectedLoading: boolean; openEntry: (id: string) => void; closeEntry: () => void;
  draft: Entry | null; editEntry: (entry: Pick<Entry, "id">) => void; newEntry: (kind: Entry["kind"], preset?: Partial<Entry>) => void; closeEditor: () => void;
  evaluation: EnrichmentTarget | null; openEvaluation: (target: EnrichmentTarget | null) => void;
  aiFilter: ActiveAiFilter | null; applyAiFilter: (filter: AiFilter | null, ids?: string[] | null) => void;
  assistantOpen: boolean; setAssistantOpen: (open: boolean) => void; askAssistant: (text: string, send?: boolean) => void; assistantPrefill: Prefill | null; takePrefill: () => Prefill | null;
  notifications: NoticeFeed; notificationsError: string; notificationsOpen: boolean; setNotificationsOpen: (open: boolean) => void; refreshNotifications: () => Promise<void>;
  reminders: Reminders; reloadReminders: () => Promise<void>;
  logoFor: (name: string) => string; brandLogos: Record<string, string>; setBrandLogos: (logos: Record<string, string>) => void;
  guard: string | null; setGuard: (message: string | null) => void; confirmLeave: () => boolean;
};
const DeskContext = createContext<Ctx | null>(null);
export function useDesk() { const value = useContext(DeskContext); if (!value) throw Error("useDesk outside DeskProvider"); return value; }

export function DeskProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [evaluationWeights, setEvaluationWeights] = useState<EvaluationWeights>(weightPresets.balanced.weights);
  const [data, setData] = useState<DeskData>({ entries: [], files: [], versions: [], watches: [], directory: emptyDirectory });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null), [detail, setDetail] = useState<{ entry: Entry; versions: VersionFull[] } | null>(null);
  const [draft, setDraft] = useState<Entry | null>(null), [returnTo, setReturnTo] = useState<string | null>(null);
  const [evaluation, openEvaluation] = useState<EnrichmentTarget | null>(null), [aiFilter, setAiFilter] = useState<ActiveAiFilter | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false), [assistantPrefill, setPrefill] = useState<Prefill | null>(null), [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NoticeFeed>({ items: [], unread: 0, latest: "0", nextBefore: null }), [notificationsError, setNotificationsError] = useState("");
  const [reminders, setReminders] = useState<Reminders>({ reminders: [], today: [] });
  const [brandLogos, setBrandLogos] = useState<Record<string, string>>({}), [guard, setGuard] = useState<string | null>(null);
  const latest = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError("");
      const next = await fetchDesk();
      setData(next);
      try {
        const feed = await readJson<{ profile: { evaluationWeights: EvaluationWeights }; states: { kind: string; target_id: string; result: { kind: string; assetUrl?: string } | null }[] }>(await fetch("/api/enrichment", { cache: "no-store" }));
        setEvaluationWeights(feed.profile.evaluationWeights);
        const logos: Record<string, string> = {};
        for (const state of feed.states) if (state.result?.kind === "brand" && state.result.assetUrl) logos[state.kind + ":" + state.target_id] = state.result.assetUrl;
        setBrandLogos(logos);
      } catch { /* the main desk data is still usable when enrichment is briefly unavailable */ }
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { let active = true; fetchDesk().then(d => { if (active) setData(d); }).catch(e => { if (active) setError((e as Error).message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const reloadReminders = useCallback(async () => { try { setReminders(await readJson<Reminders>(await fetch("/api/reminders?day=" + today(), { cache: "no-store" }))); } catch { /* the Today page shows its own error state */ } }, []);
  useEffect(() => { void Promise.resolve().then(reloadReminders); }, [reloadReminders]);

  // Full record for the open detail sheet, refetched whenever the list shows a newer revision.
  const summary = selectedId ? data.entries.find(e => e.id === selectedId) : undefined;
  useEffect(() => {
    if (!selectedId || !summary || detail?.entry.id === selectedId && detail.entry.revision === summary.revision) return;
    let active = true;
    fetchEntry(selectedId).then(d => { if (active) setDetail(d); }).catch(e => { if (active) toast.error((e as Error).message); });
    return () => { active = false; };
  }, [selectedId, summary, detail]);

  // Brand icons cached by the enrichment pipeline; loaded once so list rows can show logos.
  useEffect(() => { let active = true; fetch("/api/enrichment", { cache: "no-store" }).then(r => readJson<{ profile: { evaluationWeights: EvaluationWeights }; states: { kind: string; target_id: string; result: { kind: string; assetUrl?: string } | null }[] }>(r)).then(feed => {
    if (!active) return; setEvaluationWeights(feed.profile.evaluationWeights); const logos: Record<string, string> = {};
    for (const s of feed.states) if (s.result?.kind === "brand" && s.result.assetUrl) logos[s.kind + ":" + s.target_id] = s.result.assetUrl;
    setBrandLogos(logos);
  }).catch(() => {}); return () => { active = false; }; }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const next = await readJson<NoticeFeed>(await fetch("/api/notifications?history=false", { cache: "no-store" }));
      if (latest.current !== null && latest.current !== next.latest) void reload();
      latest.current = next.latest; setNotifications(next); setNotificationsError("");
    } catch (e) { setNotificationsError((e as Error).message); }
  }, [reload]);
  useEffect(() => {
    void Promise.resolve().then(refreshNotifications);
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshNotifications(); }, 30000);
    const focus = () => { void refreshNotifications(); void reloadReminders(); }; window.addEventListener("focus", focus);
    return () => { clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refreshNotifications, reloadReminders]);

  const saveEntry = useCallback(async (entry: Entry) => {
    const check = entrySchema.safeParse(entry); if (!check.success) throw Error(check.error.issues[0].message);
    const r = await postJson<{ entry: Entry }>("/api/desk", { action: "save", entry });
    await reload(); return r.entry;
  }, [reload]);
  const patchEntry = useCallback(async (entry: Pick<Entry, "id" | "revision">, patch: Partial<Entry>) => {
    try { return (await postJson<{ entry: Entry }>("/api/desk", { action: "patch", id: entry.id, revision: entry.revision, patch })).entry; } finally { await reload(); }
  }, [reload]);
  const removeEntry = useCallback(async (entry: Pick<Entry, "id" | "revision" | "title">) => {
    await postJson("/api/desk", { action: "delete", id: entry.id, revision: entry.revision });
    setSelectedId(current => current === entry.id ? null : current); await reload();
    toast.success(`已删除「${entry.title}」`, { action: { label: "撤销", onClick: () => { void postJson("/api/desk", { action: "undelete", id: entry.id }).then(reload).catch(e => toast.error((e as Error).message)); } }, duration: 8000 });
  }, [reload]);
  const upload = useCallback(async (entryId: string, file: File) => {
    const form = new FormData(); form.append("file", file); form.append("entryId", entryId);
    try { await readJson(await fetch("/api/desk", { method: "POST", body: form })); } finally { await reload(); }
  }, [reload]);

  const confirmLeave = useCallback(() => !guard || window.confirm(guard), [guard]);
  const applyAiFilter = useCallback((filter: AiFilter | null, ids: string[] | null = null) => {
    setAiFilter(filter ? { ...filter, ids } : null);
    if (filter) router.push(filter.kind === "competition" || filter.kind === "project" ? "/projects" : "/jobs");
  }, [router]);
  const editEntry = useCallback((entry: Pick<Entry, "id">) => {
    fetchEntry(entry.id).then(d => { setReturnTo(selectedId); setSelectedId(null); setDraft({ ...d.entry }); }).catch(e => toast.error((e as Error).message));
  }, [selectedId]);

  // Browser agents (WebMCP) may filter the visible list without writing data.
  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options: unknown) => Promise<void> } }).modelContext; if (!context) return;
    const lifecycle = new AbortController();
    context.registerTool({ name: "filter_opportunities", description: "Filter the visible job, project or competition list without changing saved records.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["job", "competition", "project"] }, query: { type: "string" } }, required: ["kind"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) { const v = input as { kind: string; query?: string }; if (!v || !["job", "competition", "project"].includes(v.kind) || v.query !== undefined && typeof v.query !== "string") throw Error("Invalid filter");
        router.push((v.kind === "job" ? "/jobs" : "/projects") + (v.query ? "?q=" + encodeURIComponent(v.query) : "")); return { kind: v.kind, query: v.query || "" }; } }, { signal: lifecycle.signal }).catch(() => {});
    return () => lifecycle.abort();
  }, [router]);

  const logoFor = useCallback((name: string) => {
    const key = identity(name); const saved = data.directory.companies.find(c => identity(c.name) === key);
    if (saved?.logoUrl) return saved.logoUrl;
    if (brandLogos["company:" + key]) return brandLogos["company:" + key];
    try { return saved?.website ? new URL("/favicon.ico", saved.website).href : ""; } catch { return ""; }
  }, [data.directory, brandLogos]);

  const full = detail && summary && detail.entry.id === summary.id && detail.entry.revision === summary.revision ? detail : null;
  const selected = full?.entry ?? summary ?? null;
  const value: Ctx = useMemo(() => ({
    evaluationWeights, setEvaluationWeights, data, loading, error, reload, saveEntry, patchEntry, removeEntry, upload,
    selected, selectedVersions: full?.versions ?? [], selectedLoading: !!summary && !full, openEntry: setSelectedId, closeEntry: () => setSelectedId(null),
    draft, editEntry,
    newEntry: (kind, preset) => { setReturnTo(null); setDraft({ ...blankEntry(kind), ...preset }); },
    // The detail sheet steps aside while editing and comes back afterwards.
    closeEditor: () => { setDraft(null); if (returnTo) setSelectedId(returnTo); setReturnTo(null); },
    evaluation, openEvaluation, aiFilter, applyAiFilter, assistantOpen, setAssistantOpen,
    askAssistant: (text: string, send = false) => { setPrefill({ text, send }); setAssistantOpen(true); }, assistantPrefill, takePrefill: () => { const value = assistantPrefill; setPrefill(null); return value; },
    notifications, notificationsError, notificationsOpen, setNotificationsOpen, refreshNotifications,
    reminders, reloadReminders, logoFor, brandLogos, setBrandLogos, guard, setGuard, confirmLeave,
  }), [evaluationWeights, data, loading, error, reload, saveEntry, patchEntry, removeEntry, upload, selected, full, summary, returnTo, draft, editEntry, evaluation, aiFilter, applyAiFilter, assistantOpen, assistantPrefill, notifications, notificationsError, notificationsOpen, refreshNotifications, reminders, reloadReminders, logoFor, brandLogos, guard, confirmLeave]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
