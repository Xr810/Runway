import { z } from "zod";
import { profileSchema } from "./enrichment-contract";
import { reminderSchema } from "./reminder-schema";

/** Optional in v1 archives; v2 archives always include personal data. */
export const personalBackupSchema = z.object({
  profile: profileSchema.refine(p => !p.cv || z.string().datetime({ offset: true }).safeParse(p.cv.uploadedAt).success, "简历日期无效"),
  cvBase64: z.string().max(7 * 1024 * 1024).refine(v => v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v), "简历文件编码无效").nullable(),
  reminders: z.array(reminderSchema).max(10000),
  done: z.array(z.object({ reminder_id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), day: z.string().date(), done_at: z.string().datetime({ offset: true }) }).strict()).max(100000),
}).strict().superRefine((value, ctx) => {
  const cv = value.profile.cv;
  if (!!cv !== !!value.cvBase64) ctx.addIssue({ code: "custom", message: "简历原文件缺失或没有对应信息" });
  if (cv && (cv.size <= 0 || cv.size > 5 * 1024 * 1024)) ctx.addIssue({ code: "custom", message: "简历大小无效" });
  if (cv && value.cvBase64) {
    const padding = value.cvBase64.endsWith("==") ? 2 : value.cvBase64.endsWith("=") ? 1 : 0;
    if (value.cvBase64.length / 4 * 3 - padding !== cv.size) ctx.addIssue({ code: "custom", message: "简历原文件长度与备份不符" });
  }
  const ids = new Set(value.reminders.map(r => r.id));
  if (ids.size !== value.reminders.length || value.done.some(d => !ids.has(d.reminder_id))) ctx.addIssue({ code: "custom", message: "提醒备份引用无效" });
});
export type PersonalBackup = z.infer<typeof personalBackupSchema>;
