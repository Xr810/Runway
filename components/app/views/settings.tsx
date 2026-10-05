"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, DatabaseBackup, Info, Plug, Sparkles, UserRound } from "lucide-react";
import { version } from "@/package.json";
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
  { key: "version", label: `Runway ${version}`, hint: "版本与更新日志", icon: Info },
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
        {current === "version" && <section aria-labelledby="version-title" className="flex flex-col gap-5">
          <div><h2 id="version-title" className="text-lg font-semibold">版本与更新日志</h2><p className="mt-1 text-sm text-muted-foreground">当前版本 {version}</p></div>
          <article className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold">0.1.0</h3>
            <p className="mt-1 text-sm">首个正式上线版本</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
              <li>岗位记录、招聘阶段与面试日程管理。</li>
              <li>AI 助手、岗位评估与招聘提醒。</li>
              <li>项目、比赛及兼职收入管理。</li>
              <li>多用户账号隔离、附件与数据备份恢复。</li>
            </ul>
          </article>
        </section>}
      </div>
    </div>
  </>;
}
