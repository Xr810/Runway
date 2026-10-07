import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadModule } from "./helpers/load-module";
import * as oauth from "../lib/chatgpt-oauth";
import * as postgres from "../lib/postgres";
import * as ai from "../lib/ai-config";

if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw Error("Use the disposable database runner");
const { pool, controlPool, runAsUser } = postgres;
const owners = [randomUUID(), randomUUID()];
for (const owner of owners)
  await controlPool.query(
    "INSERT INTO accounts(id,display_name,ai_enabled) VALUES($1,'ChatGPT mock fixture',true)",
    [owner],
  );
after(() => pool.end());
const credentials: oauth.ChatGptCredentials = {
  issuer: oauth.issuer,
  subject: "synthetic-sub",
  email: "fixture@example.invalid",
  client_id: "oaiapp_fixture",
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  id_token: "synthetic-id-token",
  scopes: oauth.scopes,
  saved_at: Date.now(),
  expires_at: Date.now() + 3600000,
};
function storage() {
  return loadModule<typeof import("../lib/chatgpt")>(
    new URL("../lib/chatgpt.ts", import.meta.url),
    {
      "./postgres": postgres,
      "./ai-config": ai,
      // Real signature/nonce validation is covered with signed JWTs in unit tests.
      "./chatgpt-oauth": {
        ...oauth,
        validateIdentity: async () => ({ subject: credentials.subject, email: credentials.email }),
      },
    },
  );
}
async function expire(owner: string, status = "connected") {
  await runAsUser(owner, async () => {
    const row = (await pool.query("SELECT value FROM meta WHERE key=$1", ["chatgpt-connection-v1"]))
      .rows[0];
    const data = JSON.parse(ai.openKey(row.value).value);
    data.credentials.expires_at = Date.now() - 1;
    data.status = status;
    await pool.query("UPDATE meta SET value=$2 WHERE key=$1", [
      "chatgpt-connection-v1",
      ai.sealKey(JSON.stringify(data)),
    ]);
  });
}
test("ChatGPT encrypted credentials isolate accounts, bind owners, recover after reload, and preserve API settings", async () => {
  const first = storage();
  await runAsUser(owners[0], async () => {
    await ai.saveAiConfig(
      {
        base: "https://api.example.invalid/v1",
        key: "synthetic-billable-key",
        model: "api-model",
        revision: 0,
        source: "settings",
        mode: "personal",
        enabled: true,
      },
      0,
    );
    await first.importChatGpt(credentials);
    assert.equal((await ai.getAiConfig()).source, "settings"); // import doesn't select
    await first.setChatGptModel("mock-model", 1);
    await first.selectAiSource("chatgpt");
    const config = await ai.getAiConfig();
    assert.equal(config.source, "chatgpt");
    assert.equal(config.key, "");
    assert(ai.isAiConfigured(config));
    assert.equal(await storage().chatGptToken(), credentials.access_token); // new module instance
    const restored = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import {runAsUser,pool} from './lib/postgres.ts';
      import {getAiConfig,isAiConfigured} from './lib/ai-config.ts';
      import {chatGptToken} from './lib/chatgpt.ts';
      try { await runAsUser('${owners[0]}',async()=>{ const config=await getAiConfig(); assert.equal(config.source,'chatgpt'); assert(isAiConfigured(config)); assert.equal(config.model,'mock-model'); assert(await chatGptToken()); }); console.log('connection restored in fresh process'); }
      finally { await pool.end(); }
    `,
      ],
      { encoding: "utf8" },
    );
    assert.match(restored, /connection restored in fresh process/);
    const row = (await pool.query("SELECT value FROM meta WHERE key=$1", [first.chatGptKey]))
      .rows[0];
    for (const secret of [
      credentials.access_token,
      credentials.refresh_token,
      credentials.id_token,
      credentials.email,
    ])
      assert(!row.value.includes(secret));
    await assert.rejects(first.setChatGptModel("stale", 1), /设置已/);
    await assert.rejects(first.importChatGpt({ ...credentials, subject: "another-sub" }), /先断开/);
  });
  await runAsUser(owners[1], async () => {
    assert.equal(await first.readChatGptConnection(), null);
    await assert.rejects(first.chatGptToken(), /未连接/);
    assert.equal((await ai.getAiConfig()).source, "none");
    const copied = await runAsUser(
      owners[0],
      async () =>
        (await pool.query("SELECT value FROM meta WHERE key=$1", [first.chatGptKey])).rows[0].value,
    );
    await pool.query("INSERT INTO meta(user_id,key,value) VALUES($1,$2,$3)", [
      owners[1],
      first.chatGptKey,
      copied,
    ]);
    await assert.rejects(first.readChatGptConnection(), /不属于/);
    await pool.query("DELETE FROM meta WHERE key=$1", [first.chatGptKey]);
  });
});
test("rotating refresh is serialized across storage instances and persists the replacement exactly once", async () => {
  await expire(owners[0]);
  let refreshes = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    const body = options!.body as URLSearchParams;
    refreshes++;
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("client_id"), credentials.client_id);
    assert.equal(body.get("refresh_token"), credentials.refresh_token);
    assert.equal(body.get("scope"), null);
    assert.equal(body.get("resource"), oauth.resource);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return Response.json({
      access_token: "replacement-access",
      refresh_token: "replacement-refresh",
      token_type: "Bearer",
      expires_in: 3600,
      scope: oauth.scopes.join(" "),
    });
  };
  const tokens = await runAsUser(owners[0], () =>
    Promise.all([storage(), storage(), storage()].map((s) => s.chatGptToken(fetcher))),
  );
  assert.deepEqual(tokens, ["replacement-access", "replacement-access", "replacement-access"]);
  assert.equal(refreshes, 1);
  await runAsUser(owners[0], async () => {
    const value = await storage().readChatGptConnection();
    assert.equal(value!.credentials.refresh_token, "replacement-refresh");
    assert.equal(value!.status, "connected");
    await storage().markChatGptUnauthorized(credentials.access_token);
    assert.equal((await storage().readChatGptConnection())!.status, "connected"); // stale 401 cannot invalidate replacement
  });
});
test("uncertain refresh/crash fails closed; revoked permissions and managed mode stop token access", async () => {
  const s = storage();
  await expire(owners[0]);
  let calls = 0;
  const fail: typeof fetch = async () => {
    calls++;
    throw Error("mock connection dropped after request");
  };
  await runAsUser(owners[0], async () => {
    await assert.rejects(s.chatGptToken(fail), /刷新失败/);
    await assert.rejects(storage().chatGptToken(fail), /结果不确定/);
    assert.equal(calls, 1);
    assert.equal((await ai.getAiConfig()).source, "chatgpt");
    assert(!ai.isAiConfigured(await ai.getAiConfig()));
    await s.importChatGpt(credentials);
  });
  await expire(owners[0]);
  await runAsUser(owners[0], async () => {
    await assert.rejects(
      s.chatGptToken(async () => Response.json({ error: "invalid_grant" }, { status: 400 })),
      /刷新失败/,
    );
    await assert.rejects(s.chatGptToken(fail), /结果不确定/);
    assert.equal(calls, 1);
    await s.importChatGpt(credentials);
  });
  await expire(owners[0], "refreshing");
  await runAsUser(owners[0], () => assert.rejects(storage().chatGptToken(fail), /结果不确定/));
  assert.equal(calls, 1);
  await controlPool.query("UPDATE accounts SET ai_enabled=false WHERE id=$1", [owners[0]]);
  await runAsUser(owners[0], () => assert.rejects(s.chatGptToken(), /未启用/));
  await controlPool.query("UPDATE accounts SET ai_enabled=true WHERE id=$1", [owners[0]]);
  process.env.AI_MODE = "managed";
  try {
    await runAsUser(owners[0], () => assert.rejects(s.chatGptToken(), /托管模式/));
  } finally {
    process.env.AI_MODE = "personal";
  }
});
test("disconnect reports remote revocation separately, erases tokens and never silently activates paid API key", async () => {
  const s = storage();
  await runAsUser(owners[0], async () => {
    const result = await s.disconnectChatGpt(async () => Response.json({}, { status: 503 }));
    assert.equal(result.revoked, false);
    assert.equal(await s.readChatGptConnection(), null);
    const config = await ai.getAiConfig();
    assert.equal(config.source, "chatgpt");
    assert.equal(config.key, "");
    assert(!ai.isAiConfigured(config));
    await s.importChatGpt(credentials);
    assert.equal(
      (
        await s.disconnectChatGpt(async (_url, init) => {
          const body = init!.body as URLSearchParams;
          assert.equal(body.get("token"), credentials.refresh_token);
          assert.equal(body.get("client_id"), credentials.client_id);
          return new Response(null, { status: 200 });
        })
      ).revoked,
      true,
    );
    await s.selectAiSource("api-key");
    assert.equal((await ai.getAiConfig()).key, "synthetic-billable-key");
  });
});
