import { test } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import * as model from "../../lib/model";
import { loadModule } from "../helpers/load-module";

test("concurrent scans and their running status belong to each account", async () => {
  const context = new AsyncLocalStorage<string>(), started: string[] = [];
  let finish!: () => void;
  const blocked = new Promise<void>(resolve => { finish = resolve; });
  const scanner = loadModule<{ runScan(trigger: "manual"): Promise<number>; scanRunning(): Promise<boolean> }>(new URL("../../lib/scanner.ts", import.meta.url), {
    "node:crypto": {}, zod: { z }, "./model": model,
    "./postgres": { currentUserId: async () => context.getStore(), runAsUser: (id: string, work: () => unknown) => context.run(id, work), pool: { query: async () => ({ rows: [] }) } },
    "./watch-storage": { allWatches: async () => { started.push(context.getStore()!); await blocked; return []; } },
    "./entries": { listEntries: async () => [] }, "./enrichment": { evaluationProfile: async () => ({}) },
    "./integration-contract": {}, "./notifications": {}, "./ai-client": {}, "./web": {}, "./ats": {},
  });
  const a = context.run("a", () => scanner.runScan("manual"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await context.run("b", () => scanner.scanRunning()), false);
  const b = context.run("b", () => scanner.runScan("manual"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(await context.run("a", () => scanner.scanRunning()), true);
  finish();
  assert.deepEqual(await Promise.all([a, b]), [0, 0]);
  assert.equal(await context.run("a", () => scanner.scanRunning()), false);
});
