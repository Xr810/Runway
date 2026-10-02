import { pool, currentUserId } from "./postgres";

/** Counts a hit for `key` in a fixed window. Returns false once `limit` is exceeded. */
export async function hit(key: string, limit: number, windowSeconds: number) {
  const scopedKey = `user:${await currentUserId()}:${key}`;
  const row = (await pool.query(`INSERT INTO rate_limits(key,count,window_start) VALUES($1,1,now())
    ON CONFLICT(key) DO UPDATE SET
      count=CASE WHEN rate_limits.window_start < now()-make_interval(secs=>$2) THEN 1 ELSE rate_limits.count+1 END,
      window_start=CASE WHEN rate_limits.window_start < now()-make_interval(secs=>$2) THEN now() ELSE rate_limits.window_start END
    RETURNING count`, [scopedKey, windowSeconds])).rows[0];
  return row.count <= limit;
}
export async function reset(key: string) { await pool.query("DELETE FROM rate_limits WHERE key=$1", [`user:${await currentUserId()}:${key}`]); }
