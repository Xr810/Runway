import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import * as model from "../../lib/model";
import * as journey from "../../lib/journey";
import { loadModule } from "../helpers/load-module";

test("company AI failures are reported and retried after cooldown instead of waiting a week", async () => {
  const attempts: Record<string, { at: string; note: string; failed?: boolean }> = {};
  const entry = { ...model.blankEntry("job"), title: "Fixture", organization: "Example" };
  let fail = true, calls = 0;
  const directory = { companies: [{ name: "Example", website: "https://example.org", logoUrl: "https://example.org/logo.png" }], channels: [] };
  const loaded = loadModule<{ completeCompanies(): Promise<{ updated: number }> }>(new URL("../../lib/company-complete.ts", import.meta.url), {
    zod: { z }, "./model": model, "./journey": journey,
    "./postgres": { pool: { query: async (sql: string, values: string[]) => {
      if (sql.startsWith("SELECT")) return { rows: [{ value: JSON.stringify(attempts) }] };
      Object.assign(attempts, JSON.parse(values[1])); return { rows: [] };
    } } },
    "./directory-storage": { getDirectory: async () => directory },
    "./entries": { listEntries: async () => [entry], patchEntry: async (_id: string, _revision: number, patch: object) => Object.assign(entry, patch) },
    "./watch-storage": { allWatches: async () => [] },
    "./ai-client": { aiJson: async () => { calls++; if (fail) throw Error("fixture 503"); return { companyType: "外企", basis: "Fixture only", confidence: "high" }; } },
    "./web": {}, "./brand-scan": {},
    "./enrichment": { enrichmentFeed: async () => ({ states: [] }), syncEnrichment: async () => {} },
    "./notifications": { notify: async () => {} },
  });
  await assert.rejects(loaded.completeCompanies(), /稍后重试/);
  const id = journey.identity("Example"); assert.equal(attempts[id].failed, true);
  await loaded.completeCompanies(); assert.equal(calls, 1);
  attempts[id].at = new Date(Date.now() - 16 * 60 * 1000).toISOString(); fail = false;
  assert.equal((await loaded.completeCompanies()).updated, 1);
  assert.equal(calls, 2); assert.equal(entry.companyType, "外企"); assert.equal(attempts[id].failed, undefined);
});
