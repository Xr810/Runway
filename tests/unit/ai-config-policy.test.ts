import { test } from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../helpers/load-module";

type ConfigModule = { getAiConfig(): Promise<{ base: string; key: string; tavilyKey?: string; mode?: string; enabled?: boolean; source: string }>; publicAiConfig(config: Record<string, unknown>): Record<string, unknown> };

function moduleFor(aiEnabled: boolean, saved?: unknown) {
  return loadModule<ConfigModule>(new URL("../../lib/ai-config.ts", import.meta.url), {
    "node:crypto": awaitCrypto,
    "./postgres": {
      currentUserId: async () => "00000000-0000-0000-0000-000000000001",
      controlPool: { query: async () => ({ rows: [{ ai_enabled: aiEnabled }] }) },
      pool: { query: async () => ({ rowCount: saved ? 1 : 0, rows: saved ? [{ value: JSON.stringify(saved) }] : [] }) },
    },
  });
}

const awaitCrypto = await import("node:crypto");
function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

test("personal AI never falls back to deployment credentials", async () => {
  const old = { mode: process.env.AI_MODE, base: process.env.AI_BASE_URL, key: process.env.AI_API_KEY, tavily: process.env.TAVILY_API_KEY };
  Object.assign(process.env, { AI_MODE: "personal", AI_BASE_URL: "https://global.example/v1", AI_API_KEY: "global", TAVILY_API_KEY: "global-search" });
  try {
    const config = await moduleFor(true).getAiConfig();
    assert.deepEqual({ base: config.base, key: config.key, tavilyKey: config.tavilyKey, source: config.source }, { base: "", key: "", tavilyKey: "", source: "none" });
  } finally {
    for (const [key, value] of Object.entries({ AI_MODE: old.mode, AI_BASE_URL: old.base, AI_API_KEY: old.key, TAVILY_API_KEY: old.tavily })) restore(key, value);
  }
});

test("managed policy uses deployment credentials but public config hides connection secrets", async () => {
  const old = process.env.AI_MODE; process.env.AI_MODE = "managed"; process.env.AI_BASE_URL = "https://managed.example/v1"; process.env.AI_API_KEY = "secret";
  try {
    const loaded = moduleFor(true), config = await loaded.getAiConfig(), visible = loaded.publicAiConfig(config as unknown as Record<string, unknown>);
    assert.equal(config.key, "secret"); assert.equal(visible.base, ""); assert.equal(visible.hasKey, false); assert.equal(visible.editable, false);
    assert.deepEqual(Object.keys(visible).sort(), ["base", "configured", "editable", "enabled", "hasKey", "hasTavilyKey", "mode", "model", "revision", "source"]);
    assert(!JSON.stringify(visible).includes("secret"));
  } finally { restore("AI_MODE", old); delete process.env.AI_BASE_URL; delete process.env.AI_API_KEY; }
});

test("account disable overrides managed availability", async () => {
  const old = process.env.AI_MODE; process.env.AI_MODE = "managed"; process.env.AI_API_KEY = "secret";
  try { const config = await moduleFor(false).getAiConfig(); assert.equal(config.enabled, false); assert.equal(config.key, ""); }
  finally { restore("AI_MODE", old); delete process.env.AI_API_KEY; }
});
