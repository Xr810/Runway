"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { defaultReminderPreferences, type ReminderPreferences } from "@/lib/recruiting-reminders";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useDesk } from "./store";

export function ReminderPreferencesEditor() {
  const { reload } = useDesk();
  const [value, setValue] = useState(defaultReminderPreferences), [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/settings/reminders", { cache: "no-store" }).then(async response => { if (!response.ok) throw Error(); return response.json(); }).then(data => setValue(data.preferences)).catch(() => toast.error("提醒设置读取失败")); }, []);
  const update = <K extends keyof ReminderPreferences>(kind: K, patch: Partial<ReminderPreferences[K]>) => setValue(current => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  async function save() { setBusy(true); try { const response = await fetch("/api/settings/reminders", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }), data = await response.json(); if (!response.ok) throw Error(data.error); setValue(data.preferences); await reload(); toast.success("提醒默认值已保存"); } catch (error) { toast.error((error as Error).message); } finally { setBusy(false); } }
  return <section className="grid gap-5"><div><h2 className="text-lg font-semibold">招聘提醒</h2><p className="text-sm text-muted-foreground">每条申请和阶段可继承、覆盖或关闭这些默认值。</p></div>{(["application", "assessment", "interview"] as const).map((kind, index) => <div className="flex flex-wrap items-center gap-3" key={kind}><Checkbox checked={value[kind].enabled} onCheckedChange={checked => update(kind, { enabled: checked === true })} /><span className="w-28 text-sm">{["投递后", "测评后", "面试后"][index]}</span><Input className="w-20" type="number" min={0} max={90} value={value[kind].days} onChange={event => update(kind, { days: Number(event.target.value) })} /><span className="text-sm text-muted-foreground">天无反馈时提醒</span>{kind === "assessment" && <select className="rounded-md border bg-background p-2 text-sm" value={value.assessment.reminderBase} onChange={event => update("assessment", { reminderBase: event.target.value as "completion" | "deadline" })}><option value="completion">从实际完成日</option><option value="deadline">从截止日</option></select>}</div>)}<Button className="w-fit" disabled={busy} onClick={() => void save()}>保存提醒设置</Button></section>;
}
