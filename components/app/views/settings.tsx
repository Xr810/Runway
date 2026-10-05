"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, DatabaseBackup, Plug, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigationGuard } from "../navigation-guard-context";
import { PageHeader } from "../ui";
import AiSettings from "../settings/ai";
import ProfileSettings from "../settings/profile";
import AutomationSettings from "../settings/automation";
import DataSettings from "../settings/data";
import { ReminderPreferencesEditor } from "../reminder-preferences";

const sections = [
  { key: "ai", label: "AI 模型", hint: "接口、密钥与模型", icon: Sparkles },
  { key: "profile", label: "个人背景", hint: "简历与求职方向", icon: UserRound },
  { key: "reminders", label: "招聘提醒", hint: "投递、测评与面试", icon: Bell },
  { key: "integrations", label: "自动化", hint: "每日扫描 · Muse 接入", icon: Plug },
  { key: "data", label: "数据与备份", hint: "导出与恢复", icon: DatabaseBackup },
] as const;
type Section = (typeof sections)[number]["key"];

export default function SettingsView() {
  const params = useSearchParams(), router = useRouter(), { confirmLeave } = useNavigationGuard();
  const current = (sections.find(s => s.key === params.get("section"))?.key ?? "ai") as Section;
  const go = (key: Section) => { if (key !== current && confirmLeave()) router.replace("/settings?section=" + key, { scroll: false }); };
  return <>
    <PageHeader title="设置" />
    <div className="grid gap-6 md:grid-cols-[208px_minmax(0,1fr)] md:gap-10">
      <nav aria-label="设置分类" className="-mx-1 flex gap-1 overflow-x-auto px-1 scrollbar-none md:mx-0 md:flex-col md:px-0">
        {sections.map(s => <button key={s.key} onClick={() => go(s.key)} aria-current={current === s.key ? "page" : undefined}
          className={cn("flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground md:py-2.5", current === s.key && "bg-card text-foreground shadow-sm ring-1 ring-border")}>
          <s.icon className="size-4 shrink-0" /><span className="flex flex-col"><span className="font-medium">{s.label}</span><span className="hidden text-xs text-muted-foreground md:block">{s.hint}</span></span>
        </button>)}
      </nav>
      <div className="max-w-2xl min-w-0">
        {current === "ai" && <AiSettings />}
        {current === "profile" && <ProfileSettings />}
        {current === "reminders" && <ReminderPreferencesEditor />}
        {current === "integrations" && <AutomationSettings />}
        {current === "data" && <DataSettings />}
      </div>
    </div>
  </>;
}
