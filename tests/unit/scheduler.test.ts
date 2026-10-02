import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../helpers/load-module";

function fixture() {
  const day = "2026-09-28";
  const state: Record<string, string | null> = { cleanupDay: day };
  const calls = { scan: 0, companies: 0, release: 0, unlock: 0, errors: 0 };
  const fail = { scan: false, companies: false, connect: false };
  const client = {
    query: async (sql: string) => { if (sql.includes("unlock")) calls.unlock++; return { rows: sql.includes("FROM accounts") ? [{ id: "account-a" }] : [{ ok: true }] }; },
    release: () => { calls.release++; },
  };
  const pool = {
    connect: async () => { if (fail.connect) throw Error("database unavailable"); return client; },
    query: async (sql: string, values: string[]) => {
      if (sql.startsWith("SELECT")) return { rows: [{ value: JSON.stringify(state) }] };
      Object.assign(state, JSON.parse(values[1])); return { rows: [] };
    },
  };
  const scheduler = loadModule<{ schedulerTick(): Promise<void> }>(new URL("../../lib/scheduler.ts", import.meta.url), {
    "./postgres": { pool, controlPool: pool, runAsUser: (_id: string, work: () => unknown) => work(), locks: { scheduler: 1 } },
    "./appointments": { RECRUITING_TIME_ZONE: "Asia/Hong_Kong" },
    "./recruiting-dispatch": { dispatchRecruitingRemindersForUser: async () => {} },
    "./scanner": { scanSettings: async () => ({ enabled: true, time: "00:00" }), runScan: async () => { calls.scan++; if (fail.scan) throw Error("source failed"); } },
    "./company-complete": { completeCompanies: async () => { calls.companies++; if (fail.companies) throw Error("AI unavailable"); } },
    "./ai-client": { aiConfigured: async () => true }, "./model": { today: () => day },
  }, { globalThis: {}, console: { error: () => { calls.errors++; } } });
  return { ...scheduler, state, calls, fail, day };
}

test("failed scans are retried after backoff, without blocking company completion", async () => {
  const f = fixture(); f.fail.scan = true;
  await f.schedulerTick();
  assert.equal(f.state.scanDay, undefined);
  assert(Date.parse(f.state.scanRetryAt!) > Date.now());
  assert(f.state.companiesAt);
  await f.schedulerTick(); assert.equal(f.calls.scan, 1);
  f.state.scanRetryAt = new Date(Date.now() - 1).toISOString(); f.fail.scan = false;
  await f.schedulerTick();
  assert.equal(f.calls.scan, 2); assert.equal(f.state.scanDay, f.day); assert.equal(f.state.scanRetryAt, null);
  await f.schedulerTick(); assert.equal(f.calls.scan, 2); assert.equal(f.calls.companies, 1);
  assert.equal(f.calls.release, 4); assert.equal(f.calls.unlock, 4);
});

test("a persisted interrupted-run backoff survives a new scheduler instance", async () => {
  const f = fixture(); f.state.scanRetryAt = new Date(Date.now() + 60000).toISOString();
  await f.schedulerTick(); assert.equal(f.calls.scan, 0); assert.equal(f.state.scanDay, undefined);
  f.state.scanRetryAt = new Date(Date.now() - 1).toISOString();
  await f.schedulerTick(); assert.equal(f.calls.scan, 1); assert.equal(f.state.scanDay, f.day);
});

test("company failures do not record success or suppress retries for six hours", async () => {
  const f = fixture(); f.fail.companies = true;
  await f.schedulerTick(); assert.equal(f.state.companiesAt, undefined); assert(f.state.companiesRetryAt);
  await f.schedulerTick(); assert.equal(f.calls.companies, 1);
  f.state.companiesRetryAt = new Date(Date.now() - 1).toISOString(); f.fail.companies = false;
  await f.schedulerTick(); assert.equal(f.calls.companies, 2); assert(f.state.companiesAt); assert.equal(f.state.companiesRetryAt, null);
});

test("database connection failures are caught and a later tick recovers", async () => {
  const f = fixture(); f.fail.connect = true;
  await assert.doesNotReject(f.schedulerTick());
  assert.equal(f.calls.errors, 1); assert.equal(f.calls.release, 0);
  f.fail.connect = false; await f.schedulerTick(); assert.equal(f.state.scanDay, f.day);
});
