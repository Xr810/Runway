"use client";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  FolderKanban,
  LogOut,
  Menu,
  Settings,
  Sparkles,
  Sun,
  Wallet,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { useDesk } from "./store";
import { useAssistantPanel } from "./assistant-panel-context";
import { useNotifications } from "./notifications-context";
import { useNavigationGuard } from "./navigation-guard-context";
import { Logo } from "./logo";
import EntryDetail from "./entry-detail";
import EntryEditor from "./entry-editor";
import NotificationsSheet from "./notifications";
import Assistant from "./assistant";
import { EvaluationDialog } from "./evaluation";

const nav = [
  { href: "/", label: "今日", icon: Sun },
  { href: "/jobs", label: "岗位", icon: BriefcaseBusiness, count: ["job"] },
  { href: "/part-time", label: "兼职与收入", icon: Wallet },
  { href: "/projects", label: "项目与比赛", icon: FolderKanban, count: ["project", "competition"] },
  { href: "/schedule", label: "日程", icon: CalendarDays },
  { href: "/companies", label: "公司", icon: Building2 },
  { href: "/insights", label: "洞察", icon: ChartNoAxesColumn },
] as const;

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname(),
    router = useRouter();
  const { data, loading, error } = useDesk();
  const { assistantOpen, setAssistantOpen } = useAssistantPanel();
  const { notifications, setNotificationsOpen } = useNotifications();
  const { confirmLeave } = useNavigationGuard();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const item =
    "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";
  const current =
    "bg-sidebar-accent font-medium text-sidebar-foreground [&_svg]:text-sidebar-foreground";
  async function logout() {
    if (!confirmLeave()) return;
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!r.ok) throw Error();
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("退出失败，请重试");
    }
  }
  const go = (e: MouseEvent) => {
    if (!confirmLeave()) e.preventDefault();
    else onNavigate?.();
  };
  return (
    <div className="flex h-full flex-col gap-0.5 px-2.5 py-3">
      <Link href="/" onClick={go} className="mb-4 flex h-8 items-center gap-2 rounded-md px-1.5">
        <Logo className="size-6 rounded-md [&_svg]:size-3.5" />
        <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
        <span className="truncate text-xs text-faint">{APP_TAGLINE}</span>
      </Link>
      <nav className="flex flex-col gap-px" aria-label="主导航">
        {nav.map((n) => {
          const count =
            "count" in n
              ? data.entries.filter((e) => (n.count as readonly string[]).includes(e.kind)).length
              : undefined;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              onClick={go}
              className={cn(item, active(n.href) && current)}
            >
              <n.icon />
              {n.label}
              {!loading && !error && !!count && (
                <span className="tabular ml-auto text-xs text-faint">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-px border-t border-sidebar-border pt-2">
        <button
          className={cn(item, assistantOpen && current)}
          aria-pressed={assistantOpen}
          onClick={() => {
            setAssistantOpen(!assistantOpen);
            onNavigate?.();
          }}
        >
          <Sparkles />
          AI 助手<Kbd className="ml-auto hidden h-4 px-1 text-[10px] lg:inline-flex">⌘J</Kbd>
        </button>
        <button
          className={item}
          onClick={() => {
            setNotificationsOpen(true);
            onNavigate?.();
          }}
        >
          <Bell />
          通知
          {notifications.unread > 0 && (
            <span className="tabular ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground">
              {notifications.unread > 99 ? "99+" : notifications.unread}
            </span>
          )}
        </button>
        <Link
          href="/settings"
          aria-current={active("/settings") ? "page" : undefined}
          onClick={go}
          className={cn(item, active("/settings") && current)}
        >
          <Settings />
          设置
        </Link>
        <button className={item} onClick={() => void logout()}>
          <LogOut />
          退出登录
        </button>
      </div>
    </div>
  );
}

export default function Shell({ children, userId }: { children: ReactNode; userId: string }) {
  const { data, loading, error, reload } = useDesk();
  const { setAssistantOpen, assistantOpen } = useAssistantPanel();
  const { notifications, setNotificationsOpen } = useNotifications();
  const { guard } = useNavigationGuard();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen(!assistantOpen);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [assistantOpen, setAssistantOpen]);
  useEffect(() => {
    if (!guard) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [guard]);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-background">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 bg-sidebar md:block">
          <NavContent />
        </aside>
        <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-card/90 px-3 backdrop-blur md:hidden">
          <button
            aria-label="打开菜单"
            className="-ml-1 inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setMenu(true)}
          >
            <Menu className="size-5" />
          </button>
          <Logo className="size-6 rounded-md [&_svg]:size-3.5" />
          <span className="text-sm font-semibold">{APP_NAME}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              aria-label={`通知${notifications.unread ? `，${notifications.unread} 条未读` : ""}`}
              className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
              onClick={() => setNotificationsOpen(true)}
            >
              <Bell className="size-[18px]" />
              {notifications.unread > 0 && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-primary" />
              )}
            </button>
            <button
              aria-label="AI 助手"
              className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
              onClick={() => setAssistantOpen(true)}
            >
              <Sparkles className="size-[18px]" />
            </button>
          </div>
        </div>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent
            side="left"
            className="w-64 border-r-0 bg-sidebar p-0"
            showCloseButton={false}
          >
            <SheetTitle className="sr-only">导航</SheetTitle>
            <NavContent onNavigate={() => setMenu(false)} />
          </SheetContent>
        </Sheet>
        <main
          className={cn(
            "transition-[padding] duration-200 md:py-2 md:pr-2 md:pl-56",
            assistantOpen && "xl:pr-[428px]",
          )}
        >
          <div className="min-h-[calc(100dvh-1rem)] md:rounded-xl md:border md:bg-card md:shadow-panel">
            <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-6 md:px-10 md:py-8">
              {(error || data.entryReadIssues.length > 0) && (
                <div
                  role="alert"
                  className="mb-5 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm"
                >
                  <p className="font-medium">
                    {error
                      ? "数据加载失败"
                      : `部分数据加载失败：${data.entryReadIssues.length} 条记录未显示`}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {error
                      ? `${error} 暂不展示旧的列表与数量；这不表示数据已删除。`
                      : "以下异常记录仍保留在数据库中，列表、公司和统计仅包含成功加载的记录。请通过应用校验及写入流程修复后重试，不要直接覆盖数据库。"}
                  </p>
                  {!error && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">查看异常记录 ID 和字段路径</summary>
                      <ul className="mt-2 space-y-1 break-all">
                        {data.entryReadIssues.map((issue) => (
                          <li key={issue.id}>
                            {issue.id}：{issue.paths.join("、")}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="outline"
                    onClick={() => void reload()}
                  >
                    重试加载
                  </Button>
                </div>
              )}
              {loading ? (
                <div role="status" aria-label="正在加载数据" className="flex flex-col gap-3">
                  <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
                  <div className="h-20 animate-pulse rounded-lg bg-muted/70" />
                  <div className="h-64 animate-pulse rounded-lg bg-muted/50" />
                </div>
              ) : !error && !(data.entryReadIssues.length && !data.entries.length) ? (
                children
              ) : null}
            </div>
          </div>
        </main>
        <EntryDetail />
        <EntryEditor />
        <NotificationsSheet />
        <EvaluationDialog />
        <Assistant key={userId} userId={userId} />
        <Toaster
          position="top-center"
          toastOptions={{ className: "!rounded-lg !border !shadow-pop !text-sm" }}
        />
      </div>
    </TooltipProvider>
  );
}
