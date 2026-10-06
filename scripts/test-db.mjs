// Only creates and destroys a new local database; never migrates DATABASE_URL.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const adminUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL || "postgresql:///postgres?host=/var/run/postgresql",
);
const host = adminUrl.searchParams.get("host") || adminUrl.hostname;
if (!["localhost", "127.0.0.1", "[::1]", "/var/run/postgresql"].includes(host))
  throw Error("Disposable test runner requires a local PostgreSQL server");
const admin = new pg.Client({ connectionString: adminUrl.toString() });
const name = "runway_backup_test_" + randomUUID().replaceAll("-", "");
const root = await mkdtemp(tmpdir() + "/runway-db-");
let created = false;
function run(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`Test process exited ${code}`)),
    );
  });
}
try {
  await admin.connect();
  const role = (
    await admin.query(
      "SELECT rolsuper,rolbypassrls,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (role.rolsuper || role.rolbypassrls || !role.rolcreatedb)
    throw Error("Use a local test role with CREATEDB, without SUPERUSER or BYPASSRLS");
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(adminUrl);
  url.pathname = "/" + name;
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    ATTACHMENTS_DIR: root,
    SCHEDULER: "off",
    AI_MODE: "personal",
    AI_API_KEY: "",
    TAVILY_API_KEY: "",
    SESSION_SECRET: randomUUID() + randomUUID(),
    AI_SETTINGS_KEY: randomUUID() + randomUUID(),
  };
  await run(["scripts/migrate.mjs"], env);
  await run(
    [
      "--test",
      "--test-concurrency=1",
      "--import",
      "tsx",
      "tests/tenant-isolation.test.ts",
      "tests/backup.test.ts",
      "tests/agent-transaction.test.ts",
      "tests/entry-read.test.ts",
      "tests/postgres-disconnect.test.ts",
      "tests/job-misc-fields.test.ts",
    ],
    env,
  );
} finally {
  try {
    if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
    await rm(root, { recursive: true, force: true });
  }
}
