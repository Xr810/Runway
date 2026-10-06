"use client";
import { useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  type Entry,
  companyTypes,
  defaultJobDeadline,
  withStatusNextAction,
  employmentTypes,
  entrySchema,
  nextActions,
  schedules,
  statusesFor,
  workModes,
} from "@/lib/model";
import { allChannels } from "@/lib/journey";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDesk } from "./store";
import { kindCopy } from "./ui";
import { StageEditor } from "./stage-editor";

function Choice({
  id,
  value,
  onChange,
  options,
  placeholder = "未设置",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((v) => (
          <SelectItem key={v || "__none"} value={v || "__none"}>
            {v || placeholder}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Field({
  label,
  htmlFor,
  hint,
  wide,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      role="group"
      aria-label={title}
      className="grid gap-x-6 gap-y-4 border-t px-6 py-5 first:border-t-0 sm:grid-cols-[168px_1fr]"
    >
      <div className="sm:pt-1">
        <p className="text-sm font-semibold">{title}</p>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function EntryEditor() {
  const { draft, closeEditor, saveEntry, openEntry, data } = useDesk();
  const [value, setValue] = useState<Entry | null>(null),
    [busy, setBusy] = useState(false);
  // Reset the working copy whenever a new draft is opened.
  const [source, setSource] = useState<Entry | null>(null);
  // "Custom next action" is a UI mode, kept apart from the text so typing does not
  // unmount the input (#3).
  const [customNext, setCustomNext] = useState(false);
  if (draft !== source) {
    setSource(draft);
    setValue(draft);
    setCustomNext(!!draft && draft.nextAction !== "" && !nextActions.includes(draft.nextAction));
  }
  const set = (key: keyof Entry, v: unknown) => setValue((d) => (d ? { ...d, [key]: v } : d));
  const isJob = value?.kind === "job",
    isNew = !!value && !value.revision,
    copy = kindCopy[value?.kind ?? "job"],
    isProject = value?.kind === "project";
  async function save() {
    if (!value) return;
    const check = entrySchema.safeParse(value);
    if (!check.success) {
      toast.error(check.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveEntry(value);
      closeEditor();
      openEntry(saved.id);
      toast.success(isNew ? "已添加" : "已保存");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(open) => {
        if (!open && !busy) closeEditor();
      }}
    >
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="border-b px-6 py-4">
          <DialogTitle>{(isNew ? "添加" : "编辑") + copy.noun}</DialogTitle>
          <DialogDescription className="mt-1">
            {isNew
              ? isProject
                ? "先写个名字，其余信息和进度都可以之后补充。"
                : "先填名称即可，其余信息可以之后补充。"
              : value?.title}
          </DialogDescription>
        </div>
        {value && (
          <form
            id="entry-form"
            className="min-h-0 flex-1 overflow-y-auto"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Group title="基本信息">
              <Field label={copy.title} htmlFor="f-title" wide>
                <Input
                  id="f-title"
                  required
                  autoFocus
                  maxLength={500}
                  value={value.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
              <Field label={copy.org} htmlFor="f-org">
                <Input
                  id="f-org"
                  value={value.organization}
                  onChange={(e) => set("organization", e.target.value)}
                />
              </Field>
              {!isProject && (
                <Field
                  label={copy.location}
                  htmlFor="f-loc"
                  hint={isJob ? "填写岗位实际工作地点，例如「香港」或「伦敦（英国）」。" : ""}
                >
                  <Input
                    id="f-loc"
                    value={value.location}
                    onChange={(e) => set("location", e.target.value)}
                  />
                </Field>
              )}
              <Field label={copy.url} htmlFor="f-url" wide>
                <Input
                  id="f-url"
                  type="url"
                  placeholder="https://"
                  value={value.url}
                  onChange={(e) => set("url", e.target.value)}
                />
              </Field>
            </Group>
            <Group title="状态与计划" description="下一步和各个日期会出现在「今日」和「日程」里。">
              <Field label="状态" htmlFor="f-status">
                <Choice
                  id="f-status"
                  value={value.status}
                  onChange={(v) => {
                    setValue((entry) =>
                      entry
                        ? { ...entry, ...withStatusNextAction(entry.kind, { status: v }) }
                        : entry,
                    );
                    if (isJob) setCustomNext(false);
                  }}
                  options={statusesFor(value.kind)}
                />
              </Field>
              <Field label="优先级" htmlFor="f-priority">
                <Choice
                  id="f-priority"
                  value={value.priority}
                  onChange={(v) => set("priority", v)}
                  options={Array.from(new Set(["", "高", "中", "低", value.priority]))}
                />
              </Field>
              {isJob ? (
                <Field label="下一步" htmlFor="f-next" wide>
                  <Choice
                    id="f-next"
                    value={customNext ? "自定义" : value.nextAction}
                    onChange={(v) => {
                      if (v === "自定义") setCustomNext(true);
                      else {
                        setCustomNext(false);
                        set("nextAction", v);
                      }
                    }}
                    options={nextActions}
                    placeholder="选择下一步"
                  />
                  {customNext && (
                    <Input
                      className="mt-2"
                      aria-label="自定义下一步"
                      placeholder="输入自定义事项"
                      value={value.nextAction}
                      onChange={(e) => set("nextAction", e.target.value)}
                    />
                  )}
                </Field>
              ) : (
                <Field label="下一步" htmlFor="f-next" wide>
                  <Input
                    id="f-next"
                    placeholder={copy.next}
                    value={value.nextAction}
                    onChange={(e) => set("nextAction", e.target.value)}
                  />
                </Field>
              )}
              <Field
                label={isProject ? "目标日期" : "截止日期"}
                htmlFor="f-deadline"
                hint={isJob && !value.deadline ? "未知时留空，不会自动生成截止日期。" : ""}
              >
                <Input
                  id="f-deadline"
                  type="date"
                  value={value.deadline || (isNew && isJob ? defaultJobDeadline(value) : "")}
                  onChange={(e) => set("deadline", e.target.value)}
                />
              </Field>
              <Field label={copy.followUp + "日期"} htmlFor="f-follow">
                <Input
                  id="f-follow"
                  type="date"
                  value={value.followUp}
                  onChange={(e) => set("followUp", e.target.value)}
                />
              </Field>
              <Field label={copy.applied + "日期"} htmlFor="f-applied">
                <Input
                  id="f-applied"
                  type="date"
                  value={value.applied}
                  onChange={(e) => set("applied", e.target.value)}
                />
              </Field>
              {copy.salary && (
                <Field label={copy.salary} htmlFor="f-salary">
                  <Input
                    id="f-salary"
                    value={value.salary}
                    onChange={(e) => set("salary", e.target.value)}
                  />
                </Field>
              )}
              {isJob && (
                <Field
                  label="公司所属国家／地区"
                  htmlFor="f-company-country"
                  hint="例如美国、德国；不是岗位工作地点。"
                >
                  <Input
                    id="f-company-country"
                    maxLength={200}
                    value={value.companyCountry}
                    onChange={(e) => set("companyCountry", e.target.value)}
                  />
                </Field>
              )}
            </Group>
            {isJob && (
              <Group title="投递" description="渠道是你实际投递的方式，与原始链接分开记录。">
                <Field label="投递渠道" htmlFor="f-channel">
                  <Input
                    id="f-channel"
                    list="channel-options"
                    maxLength={100}
                    placeholder="公司官网、Indeed…"
                    value={value.applicationChannel}
                    onChange={(e) => set("applicationChannel", e.target.value)}
                  />
                  <datalist id="channel-options">
                    {allChannels(data.entries, data.directory).map((c) => (
                      <option key={c.name} value={c.name} />
                    ))}
                  </datalist>
                </Field>
                <Field label="投递链接" htmlFor="f-apply-url">
                  <Input
                    id="f-apply-url"
                    type="url"
                    placeholder="https://"
                    value={value.applicationUrl}
                    onChange={(e) => set("applicationUrl", e.target.value)}
                  />
                </Field>
                <Field label="无回复提醒" htmlFor="f-app-reminder">
                  <Choice
                    id="f-app-reminder"
                    value={
                      value.applicationRemindersEnabled === null
                        ? "继承默认"
                        : value.applicationRemindersEnabled
                          ? "启用"
                          : "关闭"
                    }
                    onChange={(v) =>
                      set("applicationRemindersEnabled", v === "继承默认" ? null : v === "启用")
                    }
                    options={["继承默认", "启用", "关闭"]}
                  />
                </Field>
                <Field label="跟进天数" htmlFor="f-app-days">
                  <Input
                    id="f-app-days"
                    type="number"
                    min={0}
                    max={90}
                    placeholder="继承默认"
                    value={value.applicationReminderDays ?? ""}
                    onChange={(e) =>
                      set(
                        "applicationReminderDays",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </Field>
              </Group>
            )}
            {isJob && (
              <Group title="招聘阶段" description="记录多轮测评和面试；晋级后旧阶段不再提醒。">
                <StageEditor
                  value={value.appointments}
                  onChange={(appointments) => set("appointments", appointments)}
                />
              </Group>
            )}
            {isJob && (
              <Group title="岗位属性" description="用于筛选。不确定的保持「待核实」。">
                <Field label="工作模式" htmlFor="f-mode">
                  <Choice
                    id="f-mode"
                    value={value.workMode}
                    onChange={(v) => set("workMode", v)}
                    options={workModes}
                  />
                </Field>
                <Field label="岗位类型" htmlFor="f-type">
                  <Choice
                    id="f-type"
                    value={value.employmentType}
                    onChange={(v) => set("employmentType", v)}
                    options={employmentTypes}
                  />
                </Field>
                <Field label="工作时间" htmlFor="f-schedule">
                  <Choice
                    id="f-schedule"
                    value={value.schedule}
                    onChange={(v) => set("schedule", v)}
                    options={schedules}
                  />
                </Field>
                <Field label="公司类型" htmlFor="f-company-type">
                  <Choice
                    id="f-company-type"
                    value={value.companyType}
                    onChange={(v) => set("companyType", v)}
                    options={companyTypes}
                  />
                </Field>
                <Field label="分类依据链接" htmlFor="f-company-src">
                  <Input
                    id="f-company-src"
                    type="url"
                    placeholder="https://"
                    value={value.companySource}
                    onChange={(e) => set("companySource", e.target.value)}
                  />
                </Field>
                <Field
                  label="分类依据"
                  htmlFor="f-company-basis"
                  hint="按集团背景归类，不是法律股权认定。"
                  wide
                >
                  <Textarea
                    id="f-company-basis"
                    rows={2}
                    value={value.companyBasis}
                    onChange={(e) => set("companyBasis", e.target.value)}
                  />
                </Field>
              </Group>
            )}
            {isJob && (
              <Group title="公司介绍">
                <Field label="公司介绍" htmlFor="f-company-description" wide>
                  <Textarea
                    id="f-company-description"
                    rows={4}
                    maxLength={20000}
                    placeholder="公司业务、产品与背景介绍"
                    value={value.companyDescription}
                    onChange={(e) => set("companyDescription", e.target.value)}
                  />
                </Field>
              </Group>
            )}
            <Group title={copy.text} description={copy.textHint}>
              <Field label={isProject ? "说明" : "完整原文"} htmlFor="f-jd" wide>
                <Textarea
                  id="f-jd"
                  rows={10}
                  className={isProject ? "leading-relaxed" : "font-mono text-xs leading-relaxed"}
                  value={value.jd}
                  onChange={(e) => set("jd", e.target.value)}
                />
              </Field>
              {!isProject && (
                <label className="flex items-center gap-2 text-sm sm:col-span-2">
                  <Checkbox
                    checked={value.jdStatus === "complete"}
                    onCheckedChange={(v) =>
                      set(
                        "jdStatus",
                        v === true ? "complete" : value.jd || value.summary ? "partial" : "missing",
                      )
                    }
                  />
                  已核对这是完整原文
                </label>
              )}
              <Field label="摘要 / 摘录" htmlFor="f-summary" wide>
                <Textarea
                  id="f-summary"
                  rows={3}
                  value={value.summary}
                  onChange={(e) => set("summary", e.target.value)}
                />
              </Field>
            </Group>
            <Group title="备注">
              <Field label="备注" htmlFor="f-notes" wide>
                <Textarea
                  id="f-notes"
                  rows={4}
                  value={value.notes}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </Field>
            </Group>
            {isJob && (
              <Group title="手动评分" description="0–10 分。手动修改会锁定结果，自动评估不再覆盖。">
                <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
                  {(["fit", "career", "returnOffer", "academic", "outlook"] as const).map(
                    (k, i) => (
                      <Field
                        key={k}
                        label={
                          [
                            "岗位匹配度",
                            "职业路径与成长",
                            "Return Offer / 转正",
                            "学术与升学帮助",
                            "公司 / 行业前景",
                          ][i]
                        }
                        htmlFor={"f-" + k}
                      >
                        <Input
                          id={"f-" + k}
                          type="number"
                          min={0}
                          max={10}
                          step={0.5}
                          placeholder="未评分"
                          value={value[k] ?? ""}
                          onChange={(e) =>
                            set(k, e.target.value === "" ? null : Number(e.target.value))
                          }
                        />
                      </Field>
                    ),
                  )}
                </div>
              </Group>
            )}
          </form>
        )}
        <div className="flex items-center justify-end gap-2 border-t bg-muted/40 px-6 py-3">
          <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>
            取消
          </Button>
          <Button type="submit" form="entry-form" disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
            {isNew ? "添加" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
