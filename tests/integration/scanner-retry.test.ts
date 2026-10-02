// Uses a disposable PostgreSQL database and fixture network/model responses only.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { z } from "zod";
import { Pool } from "pg";
import * as model from "../../lib/model";
import { blankWatch } from "../../lib/watches";
import { detectSource } from "../../lib/ats";
import { loadModule } from "../helpers/load-module";

const url = new URL(process.env.TEST_DATABASE_URL || "http://missing");
assert.equal(url.hostname, "runway-backend-test-db");
assert.equal(url.pathname, "/runway_backend_test");
const pool = new Pool({ connectionString: url.href });
beforeEach(async () => { await pool.query("TRUNCATE crawl_runs,crawl_seen"); });
after(async () => { await pool.end(); });

function fixture() {
  const entries: model.Entry[] = [];
  const watches = ["alpha", "beta"].map(id => ({ ...blankWatch(), id, company: id, enabled: true, url: `https://boards.greenhouse.io/${id}` }));
  const behavior = { fail: "", incomplete: false, rejectLast: false, notifyFail: false };
  const fetched: string[] = [];
  const judged: string[][] = [];
  const scanner = loadModule<{ runScan(trigger: "schedule" | "manual"): Promise<number> }>(new URL("../../lib/scanner.ts", import.meta.url), {
    "node:crypto": crypto, zod: { z }, "./postgres": { pool, currentUserId: async () => "fixture", runAsUser: (_id: string, work: () => unknown) => work() }, "./model": model,
    "./integration-contract": { canonicalUrl: (value: string) => value },
    "./entries": { listEntries: async () => entries, saveEntry: async (entry: model.Entry) => { entries.push(entry); return { entry }; } },
    "./watch-storage": { allWatches: async () => watches },
    "./enrichment": { evaluationProfile: async () => ({ targets: [] }), syncEnrichment: async () => {} },
    "./notifications": { notify: async () => { if (behavior.notifyFail) throw Error("notification unavailable"); } },
    "./ai-client": { aiJson: async (_kind: string, _system: string, prompt: string) => {
      const candidates = prompt.split("候选岗位：\n")[1].split("\n").map(line => JSON.parse(line));
      judged.push(candidates.map(c => c.key));
      return { decisions: candidates.slice(0, behavior.incomplete ? -1 : undefined).map((c, i) => ({ key: c.key, add: !(behavior.rejectLast && i === candidates.length - 1), reason: "fixture", location: c.location, workMode: "待核实", employmentType: "待核实", schedule: "待核实" })) };
    } },
    "./web": { fetchJson: async (address: string) => {
      const id = /boards\/([^/]+)\/jobs/.exec(address)![1]; fetched.push(id);
      if (behavior.fail === id) throw Error("fixture upstream 503");
      if (/\/jobs\/\d+$/.test(address)) return { content: "Fixture description" };
      return { jobs: Array.from({ length: 3 }, (_, i) => ({ id: i, title: `${id} Job ${i}`, absolute_url: `https://example.org/${id}/${i}`, updated_at: "2026-09-28", location: { name: "Singapore" } })) };
    }, htmlToText: (s: string) => s }, "./ats": { detectSource },
  });
  return { ...scanner, entries, watches, behavior, fetched, judged };
}

beforeEach(async () => {
  await pool.query("INSERT INTO meta(key,value) VALUES('scanner-settings-v1',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify({ enabled: true, time: "08:00", maxAddPerWatch: 2 })]);
});

test("overflow candidates remain eligible, including legacy deferred rows", async () => {
  const f = fixture(); f.watches.splice(1);
  assert.equal(await f.runScan("manual"), 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM crawl_seen WHERE decision='deferred'")).rows[0].n, 1);
  assert.equal(await f.runScan("manual"), 1);
  assert.equal(new Set(f.entries.map(e => e.url)).size, 3);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM crawl_seen WHERE decision='added'")).rows[0].n, 3);
});

test("legacy missing judgments are retried; real rejections stay excluded", async () => {
  const f = fixture(); f.watches.splice(1); f.behavior.rejectLast = true;
  await pool.query("INSERT INTO crawl_seen(watch_id,key,decision,reason) VALUES('alpha','https://example.org/alpha/0','skipped','模型未判断')");
  assert.equal(await f.runScan("manual"), 2);
  assert.equal(await f.runScan("manual"), 0);
  assert.equal(f.judged.length, 1);
});

test("incomplete model output fails without permanently rejecting any candidate", async () => {
  const f = fixture(); f.watches.splice(1); f.behavior.incomplete = true;
  await assert.rejects(f.runScan("schedule"), /未完成/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM crawl_seen")).rows[0].n, 0);
  assert.equal(f.entries.length, 0);
  f.behavior.incomplete = false; assert.equal(await f.runScan("schedule"), 2);
});

test("scheduled retries only revisit failed sources and keep successful sources untouched", async () => {
  const f = fixture(); f.behavior.fail = "beta";
  await assert.rejects(f.runScan("schedule"), /未完成/);
  const alphaFetches = f.fetched.filter(id => id === "alpha").length;
  f.behavior.fail = ""; assert.equal(await f.runScan("schedule"), 2);
  assert.equal(f.fetched.filter(id => id === "alpha").length, alphaFetches);
  assert.equal(f.entries.length, 4);
  // Yesterday's successes must not suppress today's work.
  await pool.query("UPDATE crawl_runs SET started_at=now()-interval '1 day'");
  assert.equal(await f.runScan("schedule"), 2); assert.equal(f.entries.length, 6);
});

test("partial failures preserve the per-source daily limit on scheduled retries", async () => {
  const f = fixture(); f.watches.splice(1); f.behavior.notifyFail = true;
  await assert.rejects(f.runScan("schedule"), /未完成/); assert.equal(f.entries.length, 1);
  f.behavior.notifyFail = false; assert.equal(await f.runScan("schedule"), 1);
  assert.equal(f.entries.length, 2);
});
