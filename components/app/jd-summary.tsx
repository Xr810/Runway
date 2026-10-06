"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { jdSummarySections, type JdSummaryView } from "@/lib/jd-summary";
import { readJson, postJson } from "./store";

export function JdSummary({ entryId, fallback }: { entryId: string; fallback: string }) {
  const [view, setView] = useState<JdSummaryView | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>,
      attempts = 0;
    const load = async () => {
      try {
        const next = await readJson<JdSummaryView>(
          await fetch("/api/jd-summary?id=" + encodeURIComponent(entryId), {
            cache: "no-store",
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setView(next);
        if (next.status === "pending" && ++attempts < 12) timer = setTimeout(load, 5000);
      } catch {
        if (!controller.signal.aborted) setError("摘要读取失败，请重试。");
      }
    };
    void load();
    return () => {
      active.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [entryId]);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const next = await postJson<JdSummaryView>("/api/jd-summary", { entryId });
      if (active.current) setView(next);
    } catch (e) {
      if (active.current) setError((e as Error).message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const summary = view?.summary;
  return (
    <div className="flex flex-col gap-4">
      {!summary && !fallback && <p className="text-sm text-muted-foreground">暂无摘要。</p>}
      {fallback && <p className="whitespace-pre-wrap break-words text-sm leading-7">{fallback}</p>}
      {summary ? (
        <>
          <p className="text-xs text-muted-foreground">
            根据 JD 整理，不代表实际投递进度；要点后附原文依据，请核对含糊条件。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(jdSummarySections).map(([key, label]) => (
              <section
                key={key}
                className={
                  "min-w-0 rounded-lg border p-3 " +
                  (key === "deadlines" || key === "internship"
                    ? "border-primary/25 bg-accent/40"
                    : "bg-card")
                }
              >
                <h4 className="mb-2 text-sm font-medium">{label}</h4>
                {summary[key as keyof typeof jdSummarySections].length ? (
                  <ul className="space-y-3">
                    {summary[key as keyof typeof jdSummarySections].map((point, index) => (
                      <li key={index} className="break-words text-sm leading-relaxed">
                        <p>
                          {key === "process" ? `${index + 1}. ` : "• "}
                          {point.text}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">原文：“{point.quote}”</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">原文未明确说明，待确认。</p>
                )}
              </section>
            ))}
          </div>
          {summary.questions.length > 0 && (
            <section className="rounded-lg border p-3 text-sm">
              <h4 className="font-medium">待你确认</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {summary.questions.map((question, index) => (
                  <li key={index}>{question}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {view?.status === "unconfigured"
            ? "配置 AI 模型后可自动整理 JD；原文和手动摘要不受影响。"
            : view?.status === "pending"
              ? "等待自动整理；需后台工作进程开启，也可点击立即整理。"
              : view?.status === "missing"
                ? "暂无 JD 原文，可在编辑中补充。"
                : view?.status === "failed"
                  ? view.error
                  : "正在读取摘要…"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {view?.status !== "missing" && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? "正在整理…" : summary ? "核对 / 刷新摘要" : "立即整理摘要"}
        </Button>
      )}
    </div>
  );
}
