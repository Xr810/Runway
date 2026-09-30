import { pool, locks } from "./postgres";
import { runScan, scanSettings } from "./scanner";
import { completeCompanies } from "./company-complete";
import { aiConfigured } from "./ai-client";
import { today } from "./model";
import type { PoolClient } from "pg";

const stateKey = "scheduler-state-v1";
type State = { scanDay?: string; companiesAt?: string; cleanupDay?: string; scanRetryAt?: string | null; companiesRetryAt?: string | null; cleanupRetryAt?: string | null };
const retryDelay = 15 * 60 * 1000;
const clock = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

async function readState(): Promise<State> { const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [stateKey])).rows[0]; return row ? JSON.parse(row.value) : {}; }
async function writeState(patch: State) { await pool.query("INSERT INTO meta(key,value) VALUES($1,$2::jsonb::text) ON CONFLICT(key) DO UPDATE SET value=(meta.value::jsonb || $2::jsonb)::text", [stateKey, JSON.stringify(patch)]); }

/** Icons uploaded in the editor but never saved to a company, older than a day. */
export async function removeUnusedBrandAssets() {
  const result = await pool.query(`DELETE FROM brand_assets b WHERE b.created < now() - interval '1 day'
    AND NOT EXISTS (SELECT 1 FROM enrichment_results r WHERE r.id = b.id)
    AND NOT EXISTS (SELECT 1 FROM meta m WHERE m.key = 'company-channel-directory-v1' AND position(b.id IN m.value) > 0)`);
  return result.rowCount ?? 0;
}

export async function schedulerTick() {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    // One scheduler across processes: whoever holds the lock does the work.
    if (!(await client.query("SELECT pg_try_advisory_lock($1) AS ok", [locks.scheduler])).rows[0].ok) return;
    try {
      const state = await readState(), day = today(), now = clock();
      const ready = (at: string | null | undefined) => !at || !Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now();
      const attempt = async (retryKey: "scanRetryAt" | "companiesRetryAt" | "cleanupRetryAt", work: () => Promise<unknown>, completed: () => State) => {
        // Persist a backoff before work so a process restart also respects it. Only success
        // writes the completion marker; a failed source makes runScan reject.
        await writeState({ [retryKey]: new Date(Date.now() + retryDelay).toISOString() });
        try {
          await work();
          await writeState({ ...completed(), [retryKey]: null });
        } catch (e) {
          await writeState({ [retryKey]: new Date(Date.now() + retryDelay).toISOString() });
          console.error("Scheduled job failed", retryKey, (e as Error).message);
        }
      };
      if (state.cleanupDay !== day && now >= "04:00" && ready(state.cleanupRetryAt)) await attempt("cleanupRetryAt", removeUnusedBrandAssets, () => ({ cleanupDay: day }));
      if (!await aiConfigured()) return;
      const settings = await scanSettings();
      if (settings.enabled && state.scanDay !== day && now >= settings.time && ready(state.scanRetryAt)) await attempt("scanRetryAt", () => runScan("schedule"), () => ({ scanDay: day }));
      if ((!state.companiesAt || Date.now() - Date.parse(state.companiesAt) > 6 * 3600 * 1000) && ready(state.companiesRetryAt)) await attempt("companiesRetryAt", () => completeCompanies({ limit: 5 }), () => ({ companiesAt: new Date().toISOString() }));
    } finally { await client.query("SELECT pg_advisory_unlock($1)", [locks.scheduler]); }
  } catch (e) { console.error("Scheduler tick failed", (e as Error).message); }
  finally { client?.release(); }
}

const global = globalThis as unknown as { runwayScheduler?: NodeJS.Timeout };
export function startScheduler() {
  if (global.runwayScheduler || process.env.SCHEDULER === "off") return;
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await schedulerTick(); } catch (e) { console.error("Scheduler failed", (e as Error).message); } finally { busy = false; } };
  global.runwayScheduler = setInterval(() => void run(), 60_000);
  global.runwayScheduler.unref();
  setTimeout(() => void run(), 20_000).unref();
}
