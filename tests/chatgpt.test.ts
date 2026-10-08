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
function storage(exchangeCode = oauth.exchangeCode) {
  return loadModule<typeof import("../lib/chatgpt")>(
    new URL("../lib/chatgpt.ts", import.meta.url),
    {
      "node:crypto": { randomUUID },
      "./postgres": postgres,
      "./ai-config": ai,
      // Real signature/nonce validation is covered with signed JWTs in unit tests.
      "./chatgpt-oauth": {
        ...oauth,
        exchangeCode,
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

test("pairing is owner-bound, encrypted, replaceable, expiring, and exactly once across workers", async () => {
  let exchanges = 0;
  const exchange: typeof oauth.exchangeCode = async (attempt, callback) => {
    exchanges++;
    assert.equal(callback.searchParams.get("state"), attempt.state);
    assert.equal(callback.searchParams.get("code"), "fixture-code");
    assert.equal(attempt.redirect, "http://127.0.0.1:55432/auth/callback");
    await new Promise((resolve) => setTimeout(resolve, 20));
    return credentials;
  };
  const s = storage(exchange);
  const start = { action: "start" as const, host: `urn:uuid:${randomUUID()}`, port: 55432 };
  const first = await runAsUser(owners[1], () => s.createChatGptPairing());
  assert.equal(s.chatGptPairingOwner(first.ticket), owners[1]);
  assert.throws(() => s.chatGptPairingOwner(first.ticket + "tampered"), /无效/);
  await runAsUser(owners[0], () =>
    assert.rejects(s.processChatGptPairing(first.ticket, start), /不属于/),
  );
  await runAsUser(owners[1], async () => {
    const pair = await s.createChatGptPairing();
    await assert.rejects(s.processChatGptPairing(first.ticket, start), /已使用/);
    const result = await s.processChatGptPairing(pair.ticket, start);
    assert(typeof result.url === "string");
    const params = new URL(result.url).searchParams;
    assert.equal(params.get("ext_agent_host_id"), start.host);
    assert.equal(params.get("client_id"), "dynamic_agent_client");
    const stored = (await pool.query("SELECT value FROM meta WHERE key='chatgpt-pairing-v1'"))
      .rows[0].value;
    assert(!stored.includes(pair.ticket));
    assert(!stored.includes(params.get("state")));
    await assert.rejects(s.processChatGptPairing(pair.ticket, start), /已启动/);
    const callback = new URL(params.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: params.get("state")!,
      code: "fixture-code",
    }).toString();
    await assert.rejects(
      s.processChatGptPairing(pair.ticket, {
        action: "finish",
        callback: callback.toString().replace("55432", "55433"),
      }),
      /不匹配/,
    );
    const wrong = new URL(callback);
    wrong.searchParams.set("state", "wrong");
    await assert.rejects(
      s.processChatGptPairing(pair.ticket, { action: "finish", callback: wrong.toString() }),
      /不匹配/,
    );
    assert.equal(exchanges, 0);
    const results = await Promise.allSettled(
      [s, storage(exchange)].map((instance) =>
        instance.processChatGptPairing(pair.ticket, {
          action: "finish",
          callback: callback.toString(),
        }),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(exchanges, 1);
    assert.equal((await s.readChatGptConnection())!.pairingId, pair.id);
    assert.equal((await ai.getAiConfig()).source, "none"); // never auto-select
    await s.setChatGptModel("preserved-model", 1);
    const returning = await s.createChatGptPairing();
    const again = await s.processChatGptPairing(returning.ticket, start);
    assert(typeof again.url === "string");
    assert.equal(new URL(again.url).searchParams.get("client_id"), credentials.client_id);
    assert.equal(new URL(again.url).searchParams.get("id_token_hint"), credentials.id_token);
    // A disconnect invalidates outstanding authorizations, not just current credentials.
    await s.disconnectChatGpt(async () => new Response(null));
    await assert.rejects(s.processChatGptPairing(returning.ticket, start), /已使用/);
    const expiring = await s.createChatGptPairing();
    const realNow = Date.now;
    Date.now = () => expiring.expiresAt;
    try {
      assert.throws(() => s.chatGptPairingOwner(expiring.ticket), /过期/);
    } finally {
      Date.now = realNow;
    }
  });
});

test("pairing fails closed on uncertain code exchange, import races and live policy revocation", async () => {
  let calls = 0;
  const s = storage(async () => {
    calls++;
    throw Error("uncertain exchange");
  });
  const start = { action: "start" as const, host: `urn:uuid:${randomUUID()}`, port: 55432 };
  await runAsUser(owners[1], async () => {
    const pair = await s.createChatGptPairing();
    const result = await s.processChatGptPairing(pair.ticket, start);
    assert(typeof result.url === "string");
    const url = new URL(result.url),
      callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    callback.searchParams.set("code", "fixture-code");
    await assert.rejects(
      s.processChatGptPairing(pair.ticket, { action: "finish", callback: callback.toString() }),
      /uncertain/,
    );
    await assert.rejects(
      s.processChatGptPairing(pair.ticket, { action: "finish", callback: callback.toString() }),
      /已使用/,
    );
    assert.equal(calls, 1);
    assert.equal(await s.readChatGptConnection(), null);
    const pending = await s.createChatGptPairing();
    await s.importChatGpt(credentials);
    await assert.rejects(s.processChatGptPairing(pending.ticket, start), /已使用/);
    const revoked = await s.createChatGptPairing();
    await controlPool.query("UPDATE accounts SET ai_enabled=false WHERE id=$1", [owners[1]]);
    await assert.rejects(s.processChatGptPairing(revoked.ticket, start), /未启用/);
    await controlPool.query("UPDATE accounts SET ai_enabled=true WHERE id=$1", [owners[1]]);
    process.env.AI_MODE = "managed";
    try {
      await assert.rejects(s.processChatGptPairing(revoked.ticket, start), /托管模式/);
    } finally {
      process.env.AI_MODE = "personal";
    }
  });
});
