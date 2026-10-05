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
import { useRouter } from "next/navigation";
import type { AiFilter } from "@/lib/ai-contract";

export type ActiveAiFilter = AiFilter & { ids: string[] | null };
export type Prefill = { text: string; send: boolean };

type AssistantPanelContextValue = {
  aiFilter: ActiveAiFilter | null;
  applyAiFilter: (filter: AiFilter | null, ids?: string[] | null) => void;
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  askAssistant: (text: string, send?: boolean) => void;
  assistantPrefill: Prefill | null;
  takePrefill: () => Prefill | null;
};

const AssistantPanelContext = createContext<AssistantPanelContextValue | null>(null);

export function useAssistantPanel() {
  const value = useContext(AssistantPanelContext);
  if (!value) throw Error("useAssistantPanel outside DeskProvider");
  return value;
}

export function AssistantPanelProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [aiFilter, setAiFilter] = useState<ActiveAiFilter | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPrefill, setPrefill] = useState<Prefill | null>(null);
  const pendingPrefill = useRef<Prefill | null>(null);

  const applyAiFilter = useCallback(
    (filter: AiFilter | null, ids: string[] | null = null) => {
      setAiFilter(filter ? { ...filter, ids } : null);
      if (filter)
        router.push(
          filter.kind === "competition" || filter.kind === "project" ? "/projects" : "/jobs",
        );
    },
    [router],
  );
  const askAssistant = useCallback((text: string, send = false) => {
    pendingPrefill.current = { text, send };
    setPrefill(pendingPrefill.current);
    setAssistantOpen(true);
  }, []);
  const takePrefill = useCallback(() => {
    const value = pendingPrefill.current;
    pendingPrefill.current = null;
    setPrefill(null);
    return value;
  }, []);

  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (tool: unknown, options: unknown) => Promise<void> };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    context
      .registerTool(
        {
          name: "filter_opportunities",
          description:
            "Filter the visible job, project or competition list without changing saved records.",
          inputSchema: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["job", "competition", "project"] },
              query: { type: "string" },
            },
            required: ["kind"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input: unknown) {
            const value = input as { kind: string; query?: string };
            if (
              !value ||
              !["job", "competition", "project"].includes(value.kind) ||
              (value.query !== undefined && typeof value.query !== "string")
            )
              throw Error("Invalid filter");
            const params = new URLSearchParams();
            if (value.kind !== "job") params.set("kind", value.kind);
            if (value.query) params.set("q", value.query);
            const query = params.toString();
            router.push(
              (value.kind === "job" ? "/jobs" : "/projects") + (query ? "?" + query : ""),
            );
            return { kind: value.kind, query: value.query || "" };
          },
        },
        { signal: lifecycle.signal },
      )
      .catch(() => {});
    return () => lifecycle.abort();
  }, [router]);

  const value = useMemo(
    () => ({
      aiFilter,
      applyAiFilter,
      assistantOpen,
      setAssistantOpen,
      askAssistant,
      assistantPrefill,
      takePrefill,
    }),
    [aiFilter, applyAiFilter, assistantOpen, askAssistant, assistantPrefill, takePrefill],
  );
  return <AssistantPanelContext.Provider value={value}>{children}</AssistantPanelContext.Provider>;
}
