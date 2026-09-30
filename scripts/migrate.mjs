// Applies numbered migrations from scripts/migrations in order, once each.
// Every pending migration runs in one transaction under an advisory lock.
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";

const directory = new URL("./migrations/", import.meta.url);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(28402026)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await client.query("SELECT id FROM schema_migrations")).rows.map(row => row.id));
  const files = (await readdir(directory)).filter(name => /^\d{4}_[\w-]+\.(sql|mjs)$/.test(name)).sort();
  for (const name of files) {
    const id = name.replace(/\.(sql|mjs)$/, "");
    if (applied.has(id)) continue;
    if (name.endsWith(".sql")) await client.query(await readFile(new URL(name, directory), "utf8"));
    else await (await import(new URL(name, directory).href)).default(client);
    await client.query("INSERT INTO schema_migrations(id) VALUES($1)", [id]);
    console.log("Applied migration " + id);
  }
  await client.query("COMMIT");
  console.log("PostgreSQL schema ready");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { await client.end(); }
