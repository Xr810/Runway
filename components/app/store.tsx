"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { type Entry, type Attachment, blankEntry, entrySchema } from "@/lib/model";
import { type Directory, identity } from "@/lib/journey";
import { type CompanyWatch } from "@/lib/watches";
import { type EnrichmentTarget } from "@/lib/enrichment-contract";
import { defaultReminderPreferences, type ReminderPreferences } from "@/lib/recruiting-reminders";
import { readJson } from "@/lib/api-response";
import { AssistantPanelProvider } from "./assistant-panel-context";
import { NotificationsProvider } from "./notifications-context";
import { RemindersProvider, useReminders } from "./reminders-context";
import { NavigationGuardProvider } from "./navigation-guard-context";
export { readJson } from "@/lib/api-response";

/** List rows carry everything except the JD text; `jdChars` tells how long it is. */
export type ListEntry = Entry & { jdChars?: number };
export type VersionMeta = { id: string; entry_id: string; created: string };
export type VersionFull = VersionMeta & { data: string };
export type DeskData = {
  entries: ListEntry[];
  files: Attachment[];
  versions: VersionMeta[];
  watches: CompanyWatch[];
  directory: Directory;
  reminderPreferences: ReminderPreferences;
};
const emptyDirectory: Directory = { revision: 0, companies: [], channels: [] };

export async function postJson<T = Record<string, unknown>>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
) {
  return readJson<T>(
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );
}
async function fetchDesk(): Promise<DeskData> {
  const d = await readJson<
    Partial<DeskData> & { entries: ListEntry[]; files: Attachment[]; versions: VersionMeta[] }
  >(await fetch("/api/desk", { cache: "no-store" }));
  return {
    ...d,
    watches: d.watches || [],
    directory: d.directory || emptyDirectory,
    reminderPreferences: d.reminderPreferences ?? defaultReminderPreferences,
  };
}
export async function fetchEntry(id: string) {
  return readJson<{ entry: Entry; versions: VersionFull[] }>(
    await fetch("/api/desk?entry=" + encodeURIComponent(id), { cache: "no-store" }),
  );
}

type Ctx = {
  data: DeskData;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  refreshAfterWrite: () => Promise<boolean>;
  acceptDirectory: (directory: Directory) => void;
  saveEntry: (entry: Entry) => Promise<Entry>;
  patchEntry: (entry: Pick<Entry, "id" | "revision">, patch: Partial<Entry>) => Promise<Entry>;
  removeEntry: (entry: Pick<Entry, "id" | "revision" | "title">) => Promise<void>;
  upload: (entryId: string, file: File) => Promise<void>;
  selected: Entry | null;
  selectedVersions: VersionFull[];
  selectedLoading: boolean;
  openEntry: (id: string) => void;
  closeEntry: () => void;
  draft: Entry | null;
  editEntry: (entry: Pick<Entry, "id">) => void;
  newEntry: (kind: Entry["kind"], preset?: Partial<Entry>) => void;
  closeEditor: () => void;
  evaluation: EnrichmentTarget | null;
  openEvaluation: (target: EnrichmentTarget | null) => void;
  logoFor: (name: string) => string;
  brandLogos: Record<string, string>;
  setBrandLogos: (logos: Record<string, string>) => void;
};
const DeskContext = createContext<Ctx | null>(null);
export function useDesk() {
  const value = useContext(DeskContext);
  if (!value) throw Error("useDesk outside DeskProvider");
  return value;
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DeskData>({
    entries: [],
    files: [],
    versions: [],
    watches: [],
    directory: emptyDirectory,
    reminderPreferences: defaultReminderPreferences,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [detail, setDetail] = useState<{ entry: Entry; versions: VersionFull[] } | null>(null);
  const [draft, setDraft] = useState<Entry | null>(null),
    [returnTo, setReturnTo] = useState<string | null>(null);
  const [evaluation, openEvaluation] = useState<EnrichmentTarget | null>(null);
  const [brandLogos, setBrandLogos] = useState<Record<string, string>>({});
  const refreshVersion = useRef(0);
  const active = useRef(true);

  const refresh = useCallback(async function refreshDesk(afterWrite = false) {
    if (!active.current) return false;
    const version = ++refreshVersion.current;
    try {
      setError("");
      const next = await fetchDesk();
      if (!active.current || version !== refreshVersion.current) return false;
      setData(next);
      try {
        const feed = await readJson<{
          states: {
            kind: string;
            target_id: string;
            result: { kind: string; assetUrl?: string } | null;
          }[];
        }>(await fetch("/api/enrichment", { cache: "no-store" }));
        const logos: Record<string, string> = {};
        for (const state of feed.states)
          if (state.result?.kind === "brand" && state.result.assetUrl)
            logos[state.kind + ":" + state.target_id] = state.result.assetUrl;
        if (active.current && version === refreshVersion.current) setBrandLogos(logos);
      } catch {
        /* the main desk data is still usable when enrichment is briefly unavailable */
      }
      return true;
    } catch (e) {
      if (!active.current || version !== refreshVersion.current) return false;
      const message = afterWrite ? "已保存，但刷新失败；无需重复提交。" : (e as Error).message;
      setError(message);
      if (afterWrite)
        toast.warning(message, {
          duration: 12000,
          action: {
            label: "重试刷新",
            onClick: () => {
              void refreshDesk();
            },
          },
        });
      return false;
    } finally {
      if (active.current && version === refreshVersion.current) setLoading(false);
    }
  }, []);
  const reload = useCallback(async () => {
    await refresh();
  }, [refresh]);
  const refreshAfterWrite = useCallback(() => refresh(true), [refresh]);
  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
    };
  }, [reload]);

  const acceptEntry = useCallback((entry: Entry) => {
    if (!active.current) return;
    refreshVersion.current++;
    setData((current) => {
      const old = current.entries.find((item) => item.id === entry.id);
      if (old && old.revision > entry.revision) return current;
      const summary = { ...entry, jd: "", jdChars: entry.jd.length };
      return {
        ...current,
        entries: old
          ? current.entries.map((item) => (item.id === entry.id ? summary : item))
          : [summary, ...current.entries],
      };
    });
    setDetail((current) =>
      current?.entry.id === entry.id && current.entry.revision <= entry.revision
        ? { ...current, entry }
        : current,
    );
  }, []);
  const acceptDirectory = useCallback((directory: Directory) => {
    if (!active.current) return;
    refreshVersion.current++;
    setData((current) =>
      directory.revision >= current.directory.revision ? { ...current, directory } : current,
    );
  }, []);

  // Full record for the open detail sheet, refetched whenever the list shows a newer revision.
  const summary = selectedId ? data.entries.find((e) => e.id === selectedId) : undefined;
  useEffect(() => {
    if (
      !selectedId ||
      !summary ||
      (detail?.entry.id === selectedId && detail.entry.revision === summary.revision)
    )
      return;
    let active = true;
    fetchEntry(selectedId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) toast.error((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [selectedId, summary, detail]);

  const saveEntry = useCallback(
    async (entry: Entry) => {
      const check = entrySchema.safeParse(entry);
      if (!check.success) throw Error(check.error.issues[0].message);
      const r = await postJson<{ entry: Entry }>("/api/desk", { action: "save", entry });
      acceptEntry(r.entry);
      await refreshAfterWrite();
      return r.entry;
    },
    [acceptEntry, refreshAfterWrite],
  );
  const patchEntry = useCallback(
    async (entry: Pick<Entry, "id" | "revision">, patch: Partial<Entry>) => {
      try {
        const saved = (
          await postJson<{ entry: Entry }>("/api/desk", {
            action: "patch",
            id: entry.id,
            revision: entry.revision,
            patch,
          })
        ).entry;
        acceptEntry(saved);
        await refreshAfterWrite();
        return saved;
      } catch (error) {
        await reload();
        throw error;
      }
    },
    [acceptEntry, refreshAfterWrite, reload],
  );
  const removeEntry = useCallback(
    async (entry: Pick<Entry, "id" | "revision" | "title">) => {
      await postJson("/api/desk", { action: "delete", id: entry.id, revision: entry.revision });
      setSelectedId((current) => (current === entry.id ? null : current));
      await reload();
      toast.success(`已删除「${entry.title}」`, {
        action: {
          label: "撤销",
          onClick: () => {
            void postJson("/api/desk", { action: "undelete", id: entry.id })
              .then(reload)
              .catch((e) => toast.error((e as Error).message));
          },
        },
        duration: 8000,
      });
    },
    [reload],
  );
  const upload = useCallback(
    async (entryId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("entryId", entryId);
      try {
        await readJson(await fetch("/api/desk", { method: "POST", body: form }));
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const editEntry = useCallback(
    (entry: Pick<Entry, "id">) => {
      fetchEntry(entry.id)
        .then((d) => {
          setReturnTo(selectedId);
          setSelectedId(null);
          setDraft({ ...d.entry });
        })
        .catch((e) => toast.error((e as Error).message));
    },
    [selectedId],
  );

  const logoFor = useCallback(
    (name: string) => {
      const key = identity(name);
      const saved = data.directory.companies.find((c) => identity(c.name) === key);
      if (saved?.logoUrl) return saved.logoUrl;
      if (brandLogos["company:" + key]) return brandLogos["company:" + key];
      try {
        return saved?.website ? new URL("/favicon.ico", saved.website).href : "";
      } catch {
        return "";
      }
    },
    [data.directory, brandLogos],
  );

  const full =
    detail &&
    summary &&
    detail.entry.id === summary.id &&
    detail.entry.revision === summary.revision
      ? detail
      : null;
  const selected = full?.entry ?? summary ?? null;
  const value: Ctx = useMemo(
    () => ({
      data,
      loading,
      error,
      reload,
      refreshAfterWrite,
      acceptDirectory,
      saveEntry,
      patchEntry,
      removeEntry,
      upload,
      selected,
      selectedVersions: full?.versions ?? [],
      selectedLoading: !!summary && !full,
      openEntry: setSelectedId,
      closeEntry: () => setSelectedId(null),
      draft,
      editEntry,
      newEntry: (kind, preset) => {
        setReturnTo(null);
        setDraft({ ...blankEntry(kind), ...preset });
      },
      // The detail sheet steps aside while editing and comes back afterwards.
      closeEditor: () => {
        setDraft(null);
        if (returnTo) setSelectedId(returnTo);
        setReturnTo(null);
      },
      evaluation,
      openEvaluation,
      logoFor,
      brandLogos,
      setBrandLogos,
    }),
    [
      data,
      loading,
      error,
      reload,
      refreshAfterWrite,
      acceptDirectory,
      saveEntry,
      patchEntry,
      removeEntry,
      upload,
      selected,
      full,
      summary,
      returnTo,
      draft,
      editEntry,
      evaluation,
      logoFor,
      brandLogos,
    ],
  );
  return (
    <DeskContext.Provider value={value}>
      <RemindersProvider>
        <DeskBoundaries>{children}</DeskBoundaries>
      </RemindersProvider>
    </DeskContext.Provider>
  );
}

function DeskBoundaries({ children }: { children: ReactNode }) {
  const { reload } = useDesk();
  const { reloadReminders } = useReminders();
  return (
    <NotificationsProvider onChanged={reload} onFocus={reloadReminders}>
      <AssistantPanelProvider>
        <NavigationGuardProvider>{children}</NavigationGuardProvider>
      </AssistantPanelProvider>
    </NotificationsProvider>
  );
}
