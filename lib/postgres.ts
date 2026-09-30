import { AsyncLocalStorage } from "node:async_hooks";
import pg, { Pool, type PoolClient } from "pg";

// timestamptz columns come back as ISO strings, the shape the API has always returned.
pg.types.setTypeParser(1184, value => new Date(value).toISOString());

const globalDb = globalThis as unknown as { opportunityPool?: Pool };
const rawPool = globalDb.opportunityPool ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});
rawPool.on("error", () => console.error("PostgreSQL idle connection failed"));

// Only an explicitly scoped Agent mutation inherits a transaction. Ordinary requests
// keep their existing pool behavior; async context does not cross request boundaries.
const transactionContext = new AsyncLocalStorage<PoolClient>();
export const pool: Pool = new Proxy(rawPool, {
  get(target, property) {
    if (property === "query" && transactionContext.getStore()) return transactionContext.getStore()!.query.bind(transactionContext.getStore());
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
/** Couple the business write and its durable operation receipt in one transaction. */
export async function atomicAgentWrite<T>(work: (client: PoolClient) => Promise<T>) {
  return tx(client => transactionContext.run(client, () => work(client)), { serializable: true });
}

export type Db = Pool | PoolClient;

/**
 * Runs `work` in one transaction. Serializable transactions retry on
 * serialization failures, so revision guards and history rows stay atomic.
 */
export async function tx<T>(work: (client: PoolClient) => Promise<T>, options: { serializable?: boolean; lock?: number } = {}): Promise<T> {
  const inherited = transactionContext.getStore();
  if (inherited) {
    if (options.lock !== undefined) await inherited.query("SELECT pg_advisory_xact_lock($1)", [options.lock]);
    return work(inherited);
  }
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(options.serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
      if (options.lock !== undefined) await client.query("SELECT pg_advisory_xact_lock($1)", [options.lock]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (!options.serializable || (error as { code?: string }).code !== "40001" || attempt >= 2) throw error;
    } finally { client.release(); }
  }
}

// Advisory lock ids, one per subsystem.
export const locks = { integrationCreate: 28402027, enrichment: 28402028, scheduler: 28402029, directory: 28402030 } as const;
