import { randomUUID } from "node:crypto";
import { listEntries } from "./entries";
import { runAsUser, tx } from "./postgres";
import { recruitingReminders, reminderPreferencesSchema } from "./recruiting-reminders";

/** Scheduler entry point. The caller supplies an account and explicit Hong Kong calendar day. */
export function dispatchRecruitingRemindersForUser(userId: string, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Invalid dispatch day");
  return runAsUser(userId, () =>
    tx(
      async (client) => {
        const entries = await listEntries(client);
        const row = (
          await client.query("SELECT value FROM meta WHERE key='recruiting-reminders-v1'")
        ).rows[0];
        const preferences = reminderPreferencesSchema.parse(row ? JSON.parse(row.value) : {});
        const active = recruitingReminders(entries, preferences),
          keys = active.map((item) => `${item.id}:${item.date}`);
        await client.query(
          `UPDATE notifications SET dismissed_at=coalesce(dismissed_at,now()),read_at=coalesce(read_at,now()),source=source || '{"recruitingWithdrawn":true}'::jsonb
      WHERE recruiting_key IS NOT NULL AND dismissed_at IS NULL AND NOT (recruiting_key || ':' || recruiting_due_date::text = ANY($1::text[]))`,
          [keys],
        );
        let created = 0;
        for (const item of active.filter((item) => item.date <= day)) {
          const result = await client.query(
            `INSERT INTO notifications(id,actor,action,entry_id,title,organization,summary,source,changes,recruiting_key,recruiting_due_date)
        VALUES($1,'Runway','recruiting_reminder',$2,$3,'',$4,$5,'[]',$6,$7)
        ON CONFLICT (user_id,recruiting_key,recruiting_due_date) WHERE recruiting_key IS NOT NULL
        DO UPDATE SET dismissed_at=NULL,read_at=NULL,source=EXCLUDED.source,title=EXCLUDED.title,summary=EXCLUDED.summary
        WHERE notifications.source->>'recruitingWithdrawn'='true'`,
            [
              randomUUID(),
              item.entryId,
              item.title,
              item.source === "manual"
                ? `${item.date} 手动安排的跟进已到期`
                : `${item.date} 应跟进，仍未记录反馈`,
              JSON.stringify({
                kind: "recruiting-reminder",
                id: item.id,
                occurredAt: new Date().toISOString(),
              }),
              item.id,
              item.date,
            ],
          );
          created += result.rowCount ?? 0;
        }
        return { created, active: active.length };
      },
      { serializable: true },
    ),
  );
}
