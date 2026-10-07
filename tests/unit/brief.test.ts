import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as model from "../../lib/model";
import * as journey from "../../lib/journey";
import * as contract from "../../lib/brief-contract";
import * as recruiting from "../../lib/recruiting-reminders";
import { isAiConfigured } from "../../lib/ai-config";
import { loadModule } from "../helpers/load-module";

type LoadedBrief = {
  generateBrief(day: string): Promise<contract.Brief>;
  cachedBrief(day: string): Promise<contract.Brief | null>;
};

function fixture(failure?: Error) {
  const entries = [
    {
      ...model.blankEntry("job"),
      id: "job-1",
      title: "Original role",
      organization: "Example",
      status: "已投递",
      followUp: "2026-09-30",
      nextAction: "发送跟进邮件",
      revision: 1,
    },
  ];
  const reminders = { reminders: [], today: [] };
  const profile = { targets: ["工程"] };
  const preferences = recruiting.defaultReminderPreferences;
  const ai = {
    base: "",
    key: "",
    model: "",
    revision: 0,
    source: "none",
    mode: "personal",
    enabled: false,
  };
  let cached: { value: Record<string, unknown>; created: string } | undefined;
  let aiCalls = 0;
  const pool = {
    query: async (sql: string, values?: string[]) => {
      if (sql.includes("FROM notifications")) return { rows: [] };
      if (sql.startsWith("SELECT value, created")) return { rows: cached ? [cached] : [] };
      if (sql.startsWith("INSERT INTO ai_cache")) {
        cached = { value: JSON.parse(values![1]), created: values![2] };
        return { rows: [] };
      }
      throw Error("Unexpected SQL: " + sql);
    },
  };
  class AiUnavailable extends Error {}
  const brief = loadModule<LoadedBrief>(new URL("../../lib/brief.ts", import.meta.url), {
    "node:crypto": { createHash },
    "./brief-contract": contract,
    "./postgres": { pool },
    "./model": model,
    "./journey": journey,
    "./entries": { listEntries: async () => entries },
    "./reminders": { listReminders: async () => reminders },
    "./enrichment": { evaluationProfile: async () => profile },
    "./ai-client": {
      AiUnavailable,
      aiJson: async () => {
        aiCalls++;
        throw failure ?? new AiUnavailable();
      },
    },
    "./ai-config": { getAiConfig: async () => ai, isAiConfigured },
    "./reminder-preferences": { getReminderPreferences: async () => preferences },
    "./recruiting-reminders": recruiting,
  });
  return { brief, entries, ai, aiCalls: () => aiCalls };
}

test("brief cache is valid only for the deterministic current inputs", async () => {
  const { brief, entries, ai } = fixture();
  await brief.generateBrief("2026-10-01");
  assert(await brief.cachedBrief("2026-10-01"));
  entries[0].title = "Changed role";
  assert.equal(await brief.cachedBrief("2026-10-01"), null);
  entries[0].title = "Original role";
  ai.revision = 1;
  assert.equal(await brief.cachedBrief("2026-10-01"), null);
});

test("disabled AI uses rule priorities and supplied-day date math", async () => {
  const { brief, aiCalls } = fixture();
  const result = await brief.generateBrief("2026-10-01");
  assert.equal(aiCalls(), 0);
  assert.deepEqual(result.items[0], { text: "发送跟进邮件", entryId: "job-1", priority: "high" });
  assert(!JSON.stringify(result).includes("新加坡"));
});

for (const failure of [
  new TypeError("fetch failed"),
  new Error("模型返回的不是有效 JSON"),
  new Error("模型返回的格式不符合要求"),
]) {
  test(`brief falls back when configured AI fails: ${failure.message}`, async () => {
    const { brief, ai, aiCalls } = fixture(failure);
    Object.assign(ai, {
      base: "https://provider.test",
      key: "private-key",
      model: "test",
      enabled: true,
    });
    const result = await brief.generateBrief("2026-10-01");
    assert.equal(aiCalls(), 1);
    assert.deepEqual(result.items, [{ text: "发送跟进邮件", entryId: "job-1", priority: "high" }]);
    assert.equal((await brief.cachedBrief("2026-10-01"))?.headline, result.headline);
    assert(!JSON.stringify(result).includes("private-key"));
  });
}
