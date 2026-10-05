"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunReply } from "@/lib/agent-runtime-contract";
import { readJson } from "@/lib/api-response";
import type { AiFilter } from "@/lib/ai-contract";
import type { ActiveAiFilter, Prefill } from "./assistant-panel-context";
import { readAssistantCache, writeAssistantCache } from "./assistant-cache";
import { readAssistantPicture } from "./assistant-images";
import { assistantPollingRunIds } from "./assistant-lifecycle";
import type {
  AssistantCapability,
  AssistantMessage,
  AssistantPicture,
  AssistantRunSummary,
} from "./assistant-types";

type Options = {
  userId: string;
  open: boolean;
  pathname: string;
  selectedEntryId: string | null;
  aiFilter: ActiveAiFilter | null;
  assistantPrefill: Prefill | null;
  takePrefill: () => Prefill | null;
  applyAiFilter: (filter: AiFilter | null, ids?: string[] | null) => void;
  reload: () => Promise<void>;
  reloadReminders: () => Promise<void>;
};

export function useAssistantConversation(options: Options) {
  const {
    userId,
    open,
    pathname,
    selectedEntryId,
    aiFilter,
    assistantPrefill,
    takePrefill,
    applyAiFilter,
    reload,
    reloadReminders,
  } = options;
  const [messages, setMessages] = useState<AssistantMessage[]>([]),
    [text, setText] = useState(""),
    [pictures, setPictures] = useState<AssistantPicture[]>([]);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [reading, setReading] = useState(false),
    [error, setError] = useState("");
  const [model, setModel] = useState(""),
    [configured, setConfigured] = useState(true),
    [working, setWorking] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<AssistantCapability[]>([]),
    [runs, setRuns] = useState<AssistantRunSummary[]>([]);
  const [allowDuplicate, setAllowDuplicate] = useState<Record<string, boolean>>({});
  const abort = useRef<AbortController | null>(null),
    busy = useRef(false),
    cacheQueue = useRef(Promise.resolve());
  const ready = loadedUserId === userId;

  useEffect(() => {
    let active = true;
    readAssistantCache(userId)
      .then((value) => {
        if (active) setMessages(value.slice(-40));
      })
      .catch(() => {
        if (active) setError("浏览器聊天缓存不可用，可从运行记录恢复提案。");
      })
      .finally(() => {
        if (active) setLoadedUserId(userId);
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [userId]);
  useEffect(() => {
    if (ready)
      cacheQueue.current = cacheQueue.current
        .then(() => writeAssistantCache(userId, messages))
        .catch(() => {});
  }, [messages, ready, userId]);
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai")
      .then((r) =>
        readJson<{ configured: boolean; model: string; capabilities: AssistantCapability[] }>(r),
      )
      .then((v) => {
        setConfigured(v.configured);
        setModel(v.model);
        setCapabilities(v.capabilities ?? []);
      })
      .catch((e) => setError(e.message));
    fetch("/api/ai?runs=1")
      .then((r) => readJson<{ runs: AssistantRunSummary[] }>(r))
      .then((v) => setRuns(v.runs))
      .catch(() => {});
  }, [open, pending, working]);

  const adopt = useCallback(
    (run: AgentRunReply) =>
      setMessages((old) => {
        const found = old.some((m) => m.role === "assistant" && m.runId === run.runId);
        const message: AssistantMessage = {
          id: run.runId,
          role: "assistant",
          text: run.reply || "运行尚未生成提案，可恢复执行。",
          runId: run.runId,
          run,
        };
        return found
          ? old.map((m) => (m.role === "assistant" && m.runId === run.runId ? message : m))
          : [...old, message].slice(-40);
      }),
    [],
  );
  const loadRun = useCallback(
    async (id: string) => {
      const run = await readJson<AgentRunReply>(
        await fetch(`/api/ai/runs/${id}`, { cache: "no-store" }),
      );
      adopt(run);
      return run;
    },
    [adopt],
  );
  const pollingKey = assistantPollingRunIds(messages).join(",");
  useEffect(() => {
    if (!open || !ready || !pollingKey) return;
    const pollingIds = pollingKey.split(",");
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || !active || busy.current) return;
      inFlight = true;
      try {
        for (const id of pollingIds) {
          if (!active) break;
          try {
            const run = await readJson<AgentRunReply>(
              await fetch(`/api/ai/runs/${id}`, { cache: "no-store" }),
            );
            if (active && !busy.current) adopt(run);
          } catch {
            /* a newly sent run may not exist yet */
          }
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void refresh(), 5000);
    void refresh();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, ready, pollingKey, adopt]);

  const addPictures = useCallback(
    async (files: File[]) => {
      if (busy.current || reading) return;
      setReading(true);
      setError("");
      try {
        if (pictures.length + files.length > 6) throw Error("每次最多6张截图。");
        const next = await Promise.all(files.map(readAssistantPicture));
        setPictures((value) => [...value, ...next]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReading(false);
      }
    },
    [pictures.length, reading],
  );
  const send = useCallback(
    async (override?: string) => {
      const content = (override ?? text).trim();
      if (busy.current || reading || !ready || !configured || (!content && !pictures.length))
        return;
      const runId = crypto.randomUUID(),
        user: AssistantMessage = {
          id: crypto.randomUUID(),
          runId,
          role: "user",
          text: content || "请识别截图，生成待确认操作。",
          images: pictures,
        };
      busy.current = true;
      setPending(true);
      setError("");
      setText("");
      setPictures([]);
      setMessages((value) => [...value, user].slice(-40));
      const controller = new AbortController();
      abort.current = controller;
      try {
        const history = [...messages.slice(-15), user];
        const filter = aiFilter
          ? (({ ids, ...rest }) => {
              void ids;
              return rest;
            })(aiFilter)
          : null;
        const run = await readJson<AgentRunReply>(
          await fetch("/api/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              runId,
              page: pathname,
              selectedEntryId,
              workspace: pathname === "/part-time" ? "part-time" : "desk",
              currentFilter: filter,
              images: history
                .flatMap((m) => m.images ?? [])
                .slice(-6)
                .map(({ id, name, dataUrl }) => ({ id, name, dataUrl })),
              messages: history.map((m) => ({
                role: m.role,
                text: (
                  m.text +
                  (m.run
                    ? "\n网站提案与真实执行状态：" +
                      JSON.stringify({
                        proposals: m.run.actions?.map((a) => ({
                          id: a.id,
                          title: a.title,
                          changes: a.changes,
                        })),
                        outcomes: m.run.outcomes,
                      })
                    : "")
                ).slice(0, 35000),
              })),
            }),
          }),
        );
        adopt(run);
        setModel(run.model);
        if (run.filter) applyAiFilter(run.filter, run.matchIds ?? undefined);
      } catch (e) {
        setError(
          controller.signal.aborted
            ? "已停止等待，可从运行记录查看或恢复；写入仍需确认。"
            : (e as Error).message,
        );
      } finally {
        busy.current = false;
        setPending(false);
        abort.current = null;
      }
    },
    [
      text,
      reading,
      ready,
      configured,
      pictures,
      messages,
      aiFilter,
      pathname,
      selectedEntryId,
      adopt,
      applyAiFilter,
    ],
  );
  useEffect(() => {
    if (!open || !ready || !assistantPrefill) return;
    const prefill = takePrefill();
    queueMicrotask(() => {
      if (prefill?.send && configured) void send(prefill.text);
      else if (prefill) setText(prefill.text);
    });
  }, [open, ready, assistantPrefill, takePrefill, configured, send]);

  const decide = useCallback(
    async (runId: string, proposalId?: string, approved = false) => {
      if (busy.current) return;
      busy.current = true;
      setWorking(proposalId ?? runId);
      setError("");
      try {
        const run = await readJson<AgentRunReply>(
          await fetch(`/api/ai/runs/${runId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              proposalId
                ? {
                    action: "decide",
                    decision: {
                      proposalId,
                      approved,
                      allowDuplicate: !!allowDuplicate[proposalId],
                    },
                  }
                : { action: "recover" },
            ),
          }),
        );
        adopt(run);
        await reload();
        await reloadReminders();
        window.dispatchEvent(new Event("runway:part-time-changed"));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        busy.current = false;
        setWorking(null);
      }
    },
    [allowDuplicate, adopt, reload, reloadReminders],
  );

  return {
    messages,
    setMessages,
    text,
    setText,
    pictures,
    setPictures,
    ready,
    pending,
    reading,
    error,
    setError,
    model,
    configured,
    working,
    capabilities,
    runs,
    allowDuplicate,
    setAllowDuplicate,
    abort,
    addPictures,
    send,
    decide,
    loadRun,
  };
}
