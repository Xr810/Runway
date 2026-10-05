"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUp,
  Check,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Settings,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useDesk } from "./store";
import { useAssistantPanel } from "./assistant-panel-context";
import { useReminders } from "./reminders-context";
import { draftCommand } from "@/lib/agent-commands";
import { Pill } from "./ui";
import { useAssistantConversation } from "./use-assistant-conversation";
const fieldNames: Record<string, string> = {
  appointments: "面试 / 笔试日程",
  extra: "自定义字段",
  archived: "归档状态",
  payments: "收入记录",
  enabled: "启用",
  time: "时间",
  maxAddPerWatch: "每次最多加入",
  model: "模型",
  cvText: "简历文字",
  background: "个人背景",
  goals: "职业目标",
  targets: "求职方向",
  preferences: "偏好",
  day: "日期",
  done: "完成状态",
  item: "目录资料",
  jdStatus: "JD 存档状态",
  applicationChannel: "投递渠道",
  applicationUrl: "投递链接",
  progress: "比赛进度",
  title: "名称",
  organization: "公司 / 主办方",
  kind: "类型",
  status: "状态",
  location: "工作地点",
  workMode: "工作模式",
  employmentType: "岗位类型",
  schedule: "工作时间",
  companyType: "公司类型",
  companyBasis: "分类依据",
  companySource: "依据链接",
  url: "原始链接",
  deadline: "截止日期",
  applied: "投递日期",
  followUp: "跟进日期",
  nextAction: "下一步",
  salary: "薪资 / 奖励",
  priority: "优先级",
  summary: "摘要",
  jd: "原文摘录",
  notes: "备注",
  fit: "岗位匹配度",
  career: "职业路径与成长",
  returnOffer: "Return Offer / 转正",
  academic: "学术与升学帮助",
  outlook: "公司 / 行业前景",
};

export default function Assistant({ userId }: { userId: string }) {
  const pathname = usePathname();
  const { selected, reload } = useDesk();
  const {
    assistantOpen: open,
    setAssistantOpen,
    applyAiFilter,
    aiFilter,
    takePrefill,
    assistantPrefill,
  } = useAssistantPanel();
  const { reloadReminders } = useReminders();
  const {
    messages,
    setMessages,
    text,
    setText,
    pictures,
    setPictures,
    pending,
    reading,
    error,
    setError,
    configured,
    working,
    allowDuplicate,
    setAllowDuplicate,
    abort,
    addPictures,
    send,
    decide,
    loadRun,
  } = useAssistantConversation({
    userId,
    open,
    pathname,
    selectedEntryId: selected?.id ?? null,
    aiFilter,
    assistantPrefill,
    takePrefill,
    applyAiFilter,
    reload,
    reloadReminders,
  });
  const inputRef = useRef<HTMLTextAreaElement>(null),
    uploadRef = useRef<HTMLInputElement>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, pending]);
  if (!open) return null;
  const disabled = pending || !!working;
  return (
    <aside
      aria-label="AI 助手"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l bg-card shadow-xl"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addPictures(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <div className="flex-1">
          <p className="font-semibold">Runway 助手</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="新对话"
          disabled={disabled}
          onClick={() => {
            if (window.confirm("清空本机聊天？这不会撤销已执行的操作。")) {
              setMessages([]);
              setPictures([]);
            }
          }}
        >
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link href="/settings" aria-label="模型设置">
            <Settings />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭 AI 助手"
          onClick={() => setAssistantOpen(false)}
        >
          <X />
        </Button>
      </header>
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
        {!messages.length && (
          <div className="text-sm leading-relaxed">
            <p className="text-lg font-semibold">需要我帮什么？</p>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}
          >
            {!!m.images?.length && (
              <div className="flex gap-1">
                {m.images.map((i) => (
                  <img
                    key={i.id}
                    src={i.dataUrl}
                    alt={i.name}
                    className="size-14 rounded border object-cover"
                  />
                ))}
              </div>
            )}
            <p
              className={cn(
                "max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed",
                m.role === "user" && "rounded-xl bg-primary px-3 py-2 text-primary-foreground",
              )}
            >
              {m.text}
            </p>
            {m.run?.pages?.map((p) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-full truncate text-xs text-muted-foreground underline"
              >
                {p.title || p.url} · {p.note}
              </a>
            ))}
            {m.run?.runError && (
              <p role="alert" className="text-xs text-red-600">
                {m.run.runError}
              </p>
            )}
            {m.run && (!m.run.reply || m.run.runStatus === "recoverable") && (
              <Button size="sm" disabled={disabled} onClick={() => void decide(m.runId!)}>
                恢复运行
              </Button>
            )}
            {m.run?.actions?.map((a) => {
              const outcome = m.run!.outcomes[a.id];
              return (
                <article key={a.id} className="w-full rounded-xl border bg-background p-3">
                  <Pill
                    tone={
                      outcome?.status === "done"
                        ? "green"
                        : outcome?.status === "error"
                          ? "red"
                          : "violet"
                    }
                  >
                    {outcome
                      ? { done: "已完成", queued: "后台任务", rejected: "已拒绝", error: "未完成" }[
                          outcome.status
                        ]
                      : "待确认操作"}
                  </Pill>
                  <p className="mt-2 text-sm font-semibold">{a.title}</p>
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">查看修改前后</summary>
                    {a.changes.map((c, i) => (
                      <div key={i} className="mt-2 whitespace-pre-wrap break-all">
                        <strong>{fieldNames[c.field] ?? c.field}</strong>
                        <p>
                          修改前：
                          {typeof c.before === "string"
                            ? c.before || "（空）"
                            : JSON.stringify(c.before)}
                        </p>
                        <p>
                          修改后：
                          {typeof c.after === "string"
                            ? c.after || "（空）"
                            : JSON.stringify(c.after)}
                        </p>
                      </div>
                    ))}
                  </details>
                  {!!a.sourceImageIds?.length && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      确认后保存 {a.sourceImageIds.length} 张处理后的来源截图。
                    </p>
                  )}
                  {!!a.warnings?.length && (
                    <div className="mt-2 text-xs text-amber-700">
                      {a.warnings.join("；")}
                      <label className="mt-1 flex gap-1">
                        <input
                          type="checkbox"
                          checked={!!allowDuplicate[a.id]}
                          disabled={disabled || !!outcome}
                          onChange={(e) =>
                            setAllowDuplicate((v) => ({ ...v, [a.id]: e.target.checked }))
                          }
                        />
                        已核对，仍然新增
                      </label>
                    </div>
                  )}
                  {outcome && (
                    <p className="mt-2 text-xs" role="status">
                      {outcome.message}
                      {outcome.status === "error" ? " 请根据当前记录重新生成提案。" : ""}
                    </p>
                  )}
                  {outcome?.status === "error" && draftCommand(a) === "companyCompletion" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={disabled}
                      onClick={() => void send("重新补全公司目录里缺失的官网和官方图标")}
                    >
                      重试公司资料补全
                    </Button>
                  )}
                  {!outcome && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        disabled={disabled || (!!a.warnings?.length && !allowDuplicate[a.id])}
                        onClick={() => void decide(m.runId!, a.id, true)}
                      >
                        {working === a.id ? <LoaderCircle className="animate-spin" /> : <Check />}
                        确认执行
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() => void decide(m.runId!, a.id, false)}
                      >
                        拒绝
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
            {m.run?.filter && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => applyAiFilter(m.run!.filter!, m.run!.matchIds)}
              >
                {m.run.filter.label} · {m.run.matchCount} 条
              </Button>
            )}
            {m.role === "user" &&
              m.runId &&
              !messages.some((a) => a.role === "assistant" && a.runId === m.runId) &&
              !pending && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void loadRun(m.runId!).catch((e) => setError(e.message))}
                >
                  查看运行状态
                </Button>
              )}
          </div>
        ))}
        {pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            正在读取资料并生成提案…
          </p>
        )}
      </div>
      <div className="border-t p-3">
        <div aria-label="建议问题" className="mb-3 flex flex-col gap-2">
          {["查看本周面试", "筛选待投递岗位", "整理今日待办"].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => {
                setText(suggestion);
                inputRef.current?.focus();
              }}
              className="w-full rounded-xl border bg-background px-4 py-4 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-600">
            {error}
          </p>
        )}
        {!configured && (
          <Link href="/settings" className="text-xs underline">
            请先配置模型
          </Link>
        )}
        <div className="mb-2 flex gap-1">
          {pictures.map((p) => (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => setPictures((v) => v.filter((i) => i.id !== p.id))}
              title="移除截图"
            >
              <img src={p.dataUrl} alt={p.name} className="size-12 rounded object-cover" />
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="rounded-xl border bg-background p-2"
        >
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={disabled}
            rows={2}
            maxLength={8000}
            className="w-full resize-none bg-transparent p-1 text-sm outline-none"
            aria-label="给 AI 助手发消息"
            placeholder="说明要查询或修改什么，或粘贴截图…"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                void addPictures(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled || reading}
              aria-label="添加截图"
              onClick={() => uploadRef.current?.click()}
            >
              <ImagePlus />
            </Button>
            {pending ? (
              <Button
                type="button"
                size="icon-sm"
                aria-label="停止生成"
                onClick={() => abort.current?.abort()}
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                aria-label="发送"
                disabled={disabled || reading || !configured || (!text.trim() && !pictures.length)}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
        <input
          ref={uploadRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void addPictures(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
    </aside>
  );
}
