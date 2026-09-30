import { randomUUID } from "node:crypto";
import { pool, type Db } from "./postgres";

export type NotificationInput = {
  actor: string; action: string; summary: string; entryId?: string | null; title?: string; organization?: string;
  source?: { kind: string; id: string; subject?: string; url?: string; occurredAt?: string }; changes?: { field: string; before: unknown; after: unknown }[];
};
export async function notify(input: NotificationInput, db: Db = pool) {
  const id = randomUUID();
  await db.query("INSERT INTO notifications(id,actor,action,entry_id,title,organization,summary,source,changes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [id, input.actor, input.action, input.entryId ?? null, input.title ?? "", input.organization ?? "", input.summary,
      JSON.stringify({ subject: "", url: "", occurredAt: new Date().toISOString(), ...(input.source ?? { kind: "manual", id }) }), JSON.stringify(input.changes ?? [])]);
  return id;
}
export async function listNotifications(history: boolean, before: string | null) {
  const [rows, counts] = await Promise.all([
    pool.query(`SELECT seq::text, id, actor, action, entry_id AS "entryId", title, organization, summary, source, changes, created, read_at, dismissed_at
      FROM notifications WHERE ($1::boolean OR dismissed_at IS NULL) AND ($2::bigint IS NULL OR seq<$2::bigint) ORDER BY seq DESC LIMIT 31`, [history, before]),
    pool.query("SELECT count(*) FILTER (WHERE read_at IS NULL AND dismissed_at IS NULL)::integer AS unread, coalesce(max(seq),0)::text AS latest FROM notifications"),
  ]);
  return {
    items: rows.rows.slice(0, 30).map(({ read_at, dismissed_at, ...row }) => ({ ...row, read: !!read_at, dismissed: !!dismissed_at })),
    nextBefore: rows.rows.length > 30 ? rows.rows[29].seq : null, ...counts.rows[0],
  };
}
export async function markNotifications(action: "read" | "dismiss", ids: string[]) {
  await pool.query(action === "read" ? "UPDATE notifications SET read_at=coalesce(read_at,now()) WHERE id=ANY($1::text[])" : "UPDATE notifications SET dismissed_at=now(), read_at=coalesce(read_at,now()) WHERE id=ANY($1::text[])", [ids]);
}
