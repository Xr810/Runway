"use client";
import { useEffect, useState, type ReactNode } from "react";
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
    "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground [&_svg]:size-4 [&_svg]:shrink-0";
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
  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <Link
        href="/"
        onClick={(e) => {
          if (!confirmLeave()) e.preventDefault();
          else onNavigate?.();
        }}
        className="mb-5 flex items-center gap-2.5 px-1.5"
      >
        <Logo />
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
          <span className="text-[11px] text-muted-foreground">{APP_TAGLINE}</span>
        </span>
      </Link>
      <nav className="flex flex-col gap-0.5" aria-label="主导航">
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
              onClick={(e) => {
                if (!confirmLeave()) e.preventDefault();
                else onNavigate?.();
              }}
              className={cn(
                item,
                active(n.href) &&
                  "bg-card text-sidebar-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-sidebar-border",
              )}
            >
              <n.icon />
              {n.label}
              {!loading && !error && !!count && (
                <span className="tabular ml-auto text-xs text-muted-foreground">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <button
          className={item}
          onClick={() => {
            setAssistantOpen(!assistantOpen);
            onNavigate?.();
          }}
        >
          <Sparkles />
          AI 助手<Kbd className="ml-auto hidden lg:inline-flex">⌘J</Kbd>
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
            <span className="tabular ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-primary-foreground">
              {notifications.unread > 99 ? "99+" : notifications.unread}
            </span>
          )}
        </button>
        <Link
          href="/settings"
          aria-current={active("/settings") ? "page" : undefined}
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault();
            else onNavigate?.();
          }}
          className={cn(
            item,
            active("/settings") && "bg-card text-sidebar-foreground ring-1 ring-sidebar-border",
          )}
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
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar md:block">
          <NavContent />
        </aside>
        <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden">
          <button
            aria-label="打开菜单"
            className="-ml-1 inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
            onClick={() => setMenu(true)}
          >
            <Menu className="size-5" />
          </button>
          <Logo className="size-6" />
          <span className="font-semibold">{APP_NAME}</span>
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
          <SheetContent side="left" className="w-64 bg-sidebar p-0" showCloseButton={false}>
            <SheetTitle className="sr-only">导航</SheetTitle>
            <NavContent onNavigate={() => setMenu(false)} />
          </SheetContent>
        </Sheet>
        <main
          className={cn(
            "md:pl-60 transition-[padding] duration-200",
            assistantOpen && "xl:pr-[420px]",
          )}
        >
          <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 md:px-8 md:py-8">
            {(error || data.entryReadIssues.length > 0) && (
              <div
                role="alert"
                className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
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
                <Button className="mt-3" size="sm" variant="outline" onClick={() => void reload()}>
                  重试加载
                </Button>
              </div>
            )}
            {loading ? (
              <p role="status" className="text-sm text-muted-foreground">
                正在加载数据…
              </p>
            ) : !error && !(data.entryReadIssues.length && !data.entries.length) ? (
              children
            ) : null}
          </div>
        </main>
        <EntryDetail />
        <EntryEditor />
        <NotificationsSheet />
        <EvaluationDialog />
        <Assistant key={userId} userId={userId} />
        <Toaster richColors position="top-center" />
      </div>
    </TooltipProvider>
  );
}
