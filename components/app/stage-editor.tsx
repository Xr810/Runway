"use client";
import { Plus, Trash2 } from "lucide-react";
import { appointmentDate, appointmentTime, type Appointment } from "@/lib/appointments";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
const local = (value: string) => value ? `${appointmentDate(value)}T${appointmentTime(value)}` : "";
const iso = (value: string) => value ? new Date(value + ":00+08:00").toISOString() : "";
export function StageEditor({ value, onChange }: { value: Appointment[]; onChange: (value: Appointment[]) => void }) {
  const patch = (id: string, change: Partial<Appointment>) => onChange(value.map(item => item.id === id ? { ...item, ...change } : change.stageState === "current" && item.type !== "followup" ? { ...item, stageState: "superseded" } : item));
  const add = (type: "assessment" | "interview") => onChange([
    ...value.map(item => item.stageState === "current" ? { ...item, stageState: "superseded" as const } : item),
    { id: crypto.randomUUID(), title: type === "assessment" ? "测评" : "面试", type, startsAt: "", location: "", url: "", status: "scheduled", receivedDate: "", deadlineDate: "", completedAt: "", response: "pending", stageState: "current", reminderDays: null, remindersEnabled: null, reminderBase: null },
  ]);
  const field = "grid content-start gap-1.5 text-xs text-muted-foreground";
  return <div className="grid gap-3 sm:col-span-2">
    {value.length > 0 && <p className="text-xs text-faint">日期和时间按香港时间（UTC+8）填写，不随设备时区转换。</p>}
    {value.map((item, index) => <div key={item.id} className={cn("overflow-hidden rounded-lg border", item.stageState === "superseded" && "opacity-70")}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="tabular inline-flex size-5 shrink-0 items-center justify-center rounded bg-card text-[11px] font-medium text-muted-foreground ring-1 ring-border">{index + 1}</span>
        <Input aria-label="阶段名称" className="h-7 flex-1" value={item.title} onChange={event => patch(item.id, { title: event.target.value })}/>
        <Select value={item.type} onValueChange={type => patch(item.id, { type: type as Appointment["type"], reminderBase: null })}><SelectTrigger size="sm" aria-label="阶段类型" className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="assessment">笔试 / 测评</SelectItem><SelectItem value="interview">面试</SelectItem><SelectItem value="followup">跟进</SelectItem></SelectContent></Select>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`删除阶段 ${item.title}`} className="text-muted-foreground hover:text-danger" onClick={() => onChange(value.filter((_, i) => i !== index))}><Trash2 /></Button>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-3">
        <label className={field}>收到通知<Input type="date" value={item.receivedDate} onChange={event => patch(item.id, { receivedDate: event.target.value })}/></label>
        {item.type === "assessment" ? <label className={field}>截止日期<Input type="date" value={item.deadlineDate} onChange={event => patch(item.id, { deadlineDate: event.target.value })}/></label> : <label className={field}>预约时间（香港）<Input type="datetime-local" value={local(item.startsAt)} onChange={event => patch(item.id, { startsAt: iso(event.target.value) })}/></label>}
        <label className={field}>状态<Select value={item.status} onValueChange={status => patch(item.id, { status: status as Appointment["status"], completedAt: status === "completed" ? new Date().toISOString() : "" })}><SelectTrigger aria-label="阶段状态" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="scheduled">待进行</SelectItem><SelectItem value="completed">{item.type === "interview" ? "已参加" : "已完成"}</SelectItem><SelectItem value="cancelled">已取消 / 未参加</SelectItem></SelectContent></Select></label>
        {item.status === "completed" && item.type === "assessment" && <label className={field}>实际完成日期<Input type="date" value={appointmentDate(item.completedAt)} onChange={event => patch(item.id, { completedAt: event.target.value ? iso(event.target.value + "T00:00") : "" })}/></label>}
        {item.status === "completed" && <label className={field}>反馈<Select value={item.response} onValueChange={response => patch(item.id, { response: response as Appointment["response"], stageState: response === "pending" ? "current" : "superseded" })}><SelectTrigger aria-label="阶段反馈" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">等待反馈</SelectItem><SelectItem value="advanced">已晋级</SelectItem><SelectItem value="rejected">未通过</SelectItem></SelectContent></Select></label>}
        <label className={field}>提醒<Select value={item.remindersEnabled === null ? "inherit" : item.remindersEnabled ? "on" : "off"} onValueChange={setting => patch(item.id, { remindersEnabled: setting === "inherit" ? null : setting === "on" })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">继承默认</SelectItem><SelectItem value="on">启用</SelectItem><SelectItem value="off">关闭</SelectItem></SelectContent></Select></label>
        <label className={field}>无反馈天数<Input type="number" min={0} max={90} placeholder="继承默认" value={item.reminderDays ?? ""} onChange={event => patch(item.id, { reminderDays: event.target.value ? Number(event.target.value) : null })}/></label>
        {item.type === "assessment" && <label className={field}>提醒日期基准<Select value={item.reminderBase ?? "inherit"} onValueChange={basis => patch(item.id, { reminderBase: basis === "inherit" ? null : basis as "completion" | "deadline" })}><SelectTrigger aria-label="提醒日期基准" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">继承默认</SelectItem><SelectItem value="completion">实际完成日</SelectItem><SelectItem value="deadline">截止日</SelectItem></SelectContent></Select></label>}
      </div>
    </div>)}
    <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => add("assessment")}><Plus />添加测评</Button><Button type="button" size="sm" variant="outline" onClick={() => add("interview")}><Plus />添加面试</Button></div>
  </div>;
}
