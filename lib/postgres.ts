import { AsyncLocalStorage } from "node:async_hooks";
import pg, { Pool, type PoolClient } from "pg";

// timestamptz columns come back as ISO strings, the shape the API has always returned.
pg.types.setTypeParser(1184, (value) => new Date(value).toISOString());

const globalDb = globalThis as unknown as { opportunityPool?: Pool };
const rawPool = (globalDb.opportunityPool ??= new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
}));
rawPool.on("error", () => console.error("PostgreSQL idle connection failed"));

// Only account/session/token lookup and worker enumeration use this pool.
export const controlPool = rawPool;
const userContext = new AsyncLocalStorage<string>();
export function runAsUser<T>(userId: string, work: () => T): T {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(userId))
    throw Error("Invalid account ID");
  return userContext.run(userId, work);
}
export async function currentUserId(): Promise<string> {
  const scoped = userContext.getStore();
  if (scoped) return scoped;
  // Resolve identity in the request itself. enterWith() in an async auth helper
  // does not propagate reliably to its caller and must not leak across requests.
  const { getUser } = await import("./auth");
  const user = await getUser();
  if (user) return user.userId;
  const { headers } = await import("next/headers");
  const authorization = (await headers()).get("authorization") ?? "";
  if (/^Bearer od_[A-Za-z0-9_-]{43}$/.test(authorization)) {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(authorization.slice(7)).digest("hex");
    const row = (
      await controlPool.query(
        "SELECT user_id FROM integration_tokens WHERE token_hash=$1 AND revoked_at IS NULL",
        [hash],
      )
    ).rows[0];
    if (row) return row.user_id;
  }
  throw Error("Authenticated account required");
}

async function scopedClient(): Promise<PoolClient> {
  const userId = await currentUserId(),
    client = await rawPool.connect();
  try {
    await client.query("SELECT set_config('runway.user_id',$1,false)", [userId]);
  } catch (error) {
    client.release(true);
    throw error;
  }
  // Destroy rather than recycle if reset fails: no next request can inherit identity.
  return new Proxy(client, {
    get(target, property) {
      if (property === "release")
        return (error?: Error | boolean) => {
          if (error) {
            target.release(error);
            return;
          }
          void target.query("RESET runway.user_id").then(
            () => target.release(),
            () => target.release(true),
          );
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const transactionContext = new AsyncLocalStorage<PoolClient>();
export const pool: Pool = new Proxy(rawPool, {
  get(target, property) {
    if (property === "connect") return scopedClient;
    if (property === "query")
      return async (...args: unknown[]) => {
        const inherited = transactionContext.getStore();
        if (inherited) return Reflect.apply(inherited.query, inherited, args);
        const client = await scopedClient();
        try {
          return await Reflect.apply(client.query, client, args);
        } finally {
          client.release();
        }
      };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
/** Couple the business write and its durable operation receipt in one transaction.
 * pool.query and nested tx inherit this client. pool.connect/controlPool do NOT:
 * domain writers called here must use tx, pool.query, or the supplied client.
 * The callback may retry; never send mail or invoke irreversible external work here.
 * Filesystem publication must be idempotent and must not delete on uncertain commit.
 */
export async function atomicAgentWrite<T>(work: (client: PoolClient) => Promise<T>) {
  return tx((client) => transactionContext.run(client, () => work(client)), { serializable: true });
}

export type Db = Pool | PoolClient;

/**
 * Runs `work` in one transaction. Serializable transactions retry on
 * serialization failures, so revision guards and history rows stay atomic.
 */
export async function tx<T>(
  work: (client: PoolClient) => Promise<T>,
  options: { serializable?: boolean; lock?: number } = {},
): Promise<T> {
  const inherited = transactionContext.getStore();
  if (inherited) {
    if (options.lock !== undefined)
      await inherited.query("SELECT pg_advisory_xact_lock($1)", [options.lock]);
    return work(inherited);
  }
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(options.serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
      if (options.lock !== undefined)
        await client.query("SELECT pg_advisory_xact_lock($1)", [options.lock]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (!options.serializable || (error as { code?: string }).code !== "40001" || attempt >= 2)
        throw error;
    } finally {
      client.release();
    }
  }
}

// Advisory lock ids, one per subsystem.
export const locks = {
  integrationCreate: 28402027,
  enrichment: 28402028,
  scheduler: 28402029,
  directory: 28402030,
} as const;
