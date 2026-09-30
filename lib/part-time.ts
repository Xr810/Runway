import { pool, tx } from "./postgres";
import { gigSchema, type Gig } from "./part-time-contract";

export class GigError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function listGigs(): Promise<Gig[]> {
  const result = await pool.query<{ data: Gig; revision: number }>("SELECT data, revision FROM part_time_records ORDER BY updated DESC, id");
  return result.rows.map(row => ({ ...row.data, revision: row.revision }));
}
export async function saveGig(input: unknown, restore = false) {
  const parsed = gigSchema.safeParse(input);
  if (!parsed.success) throw new GigError(400, parsed.error.issues[0].message);
  const item = parsed.data;
  return tx(async client => {
    if (restore) {
      const restored = { ...item, revision: 1 };
      const inserted = await client.query("INSERT INTO part_time_records(id,data,revision) VALUES($1,$2,1) ON CONFLICT(id) DO NOTHING RETURNING id", [item.id, JSON.stringify(restored)]);
      if (inserted.rowCount) return restored;
      const existing = (await client.query<{ data: Gig; revision: number }>("SELECT data, revision FROM part_time_records WHERE id=$1", [item.id])).rows[0];
      return { ...existing.data, revision: existing.revision };
    }
    const old = (await client.query<{ revision: number }>("SELECT revision FROM part_time_records WHERE id=$1 FOR UPDATE", [item.id])).rows[0];
    if ((old?.revision ?? 0) !== item.revision) throw new GigError(409, "这条兼职已在其他窗口更新，请关闭编辑窗口并重新加载后再试。");
    const next = { ...item, revision: item.revision + 1 };
    const result = old
      ? await client.query("UPDATE part_time_records SET data=$2, revision=$3, updated=now() WHERE id=$1 AND revision=$4", [item.id, JSON.stringify(next), next.revision, item.revision])
      : await client.query("INSERT INTO part_time_records(id,data,revision) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", [item.id, JSON.stringify(next), next.revision]);
    if (!result.rowCount) throw new GigError(409, "记录已更新，请重新加载后再试。");
    return next;
  });
}
