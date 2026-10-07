import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { generateKeyPair, SignJWT } from "jose";
import {
  authorizationAttempt,
  exchangeCode,
  validateIdentity,
  protectTransfer,
  unprotectTransfer,
  scopes,
  issuer,
  resource,
  type ChatGptCredentials,
} from "../../lib/chatgpt-oauth";
import { readResponsesStream, responsesBody } from "../../lib/ai-model";
import { isAiConfigured, publicAiConfig } from "../../lib/ai-config";
import { loadModule } from "../helpers/load-module";
import * as oauth from "../../lib/chatgpt-oauth";
import { runModelGraph } from "../../lib/agent-model-loop";
import { assertAgentCommand, agentPolicy } from "../../lib/agent-policy";

const config = {
  base: resource,
  key: "",
  model: "listed-model",
  revision: 1,
  source: "chatgpt" as const,
  mode: "personal" as const,
  enabled: true,
  subscriptionReady: true,
};
const saved: ChatGptCredentials = {
  issuer,
  subject: "mock-sub",
  email: "fixture@example.invalid",
  client_id: "oaiapp_fixture",
  access_token: "mock-access",
  refresh_token: "mock-refresh",
  id_token: "mock-id",
  scopes,
  expires_at: Date.now() + 3600000,
  saved_at: Date.now(),
};
const frame = (event: object) => `data: ${JSON.stringify(event)}\r\n\r\n`;
function stream(text: string) {
  const bytes = new TextEncoder().encode(text);
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (index >= bytes.length) controller.close();
        else controller.enqueue(bytes.slice(index, ++index));
      },
    }),
  );
}
function completed(text: string) {
  return stream(
    frame({ type: "response.output_text.delta", delta: text }) +
      frame({ type: "response.completed", response: { status: "completed" } }),
  );
}

test("CLI persists separate host identifiers with owner-only permissions across restarts", async () => {
  const root = await mkdtemp(tmpdir() + "/runway-chatgpt-host-");
  try {
    const run = (host: string) =>
      execFileSync(process.execPath, [
        "--import",
        "tsx",
        "scripts/chatgpt.ts",
        "host",
        "--host-file",
        host,
      ]);
    const laptop = root + "/laptop",
      vm = root + "/vm";
    run(laptop);
    const first = await readFile(laptop, "utf8");
    run(laptop);
    run(vm);
    assert.equal(await readFile(laptop, "utf8"), first);
    assert.notEqual(await readFile(vm, "utf8"), first);
    assert.match(first, /^urn:uuid:[a-f0-9-]{36}$/);
    assert.equal((await stat(laptop)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dynamic registration uses exact loopback, fresh state/nonce/PKCE and returning client identity", () => {
  const a = authorizationAttempt("urn:uuid:fixture", "http://127.0.0.1:54321/auth/callback"),
    b = authorizationAttempt("urn:uuid:fixture", a.redirect, saved);
  const p = new URL(a.url).searchParams;
  assert.equal(p.get("client_id"), "dynamic_agent_client");
  assert.equal(p.get("agent_name_hint"), "Runway");
  assert.equal(
    p.get("code_challenge"),
    createHash("sha256").update(a.verifier).digest("base64url"),
  );
  assert.equal(p.get("resource"), resource);
  assert.equal(p.get("scope"), scopes.join(" "));
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.nonce, b.nonce);
  const returning = new URL(b.url).searchParams;
  assert.equal(returning.get("client_id"), saved.client_id);
  assert.equal(returning.get("agent_name_hint"), null);
  assert.equal(returning.get("id_token_hint"), saved.id_token);
  for (const invalid of [
    "http://localhost:54321/auth/callback",
    "https://public.example/auth/callback",
    "http://127.0.0.1:54321/callback",
  ])
    assert.throws(() => authorizationAttempt("host", invalid));
});
test("OAuth validates signatures, issuer, audience, expiry, nonce, returning subject and granted scopes", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256"),
    keys = async () => publicKey;
  const attempt = authorizationAttempt("host", "http://127.0.0.1:54321/auth/callback");
  async function jwt(patch: object = {}) {
    return new SignJWT({ nonce: attempt.nonce, email: saved.email, ...patch })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience(saved.client_id)
      .setSubject(saved.subject)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }
  const idToken = await jwt();
  let exchanged = 0;
  const mock: typeof fetch = async (url, init) => {
    exchanged++;
    assert.equal(String(url), `${issuer}/api/accounts/oauth/token`);
    const body = init!.body as URLSearchParams;
    assert.equal(body.get("client_id"), saved.client_id);
    assert.equal(body.get("code_verifier"), attempt.verifier);
    assert.equal(body.get("redirect_uri"), attempt.redirect);
    return Response.json({
      access_token: "a",
      refresh_token: "r",
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: scopes.join(" "),
    });
  };
  const callback = new URL(
    attempt.redirect + `?code=fixture&client_id=${saved.client_id}&state=${attempt.state}`,
  );
  assert.equal((await exchangeCode(attempt, callback, mock, keys)).subject, saved.subject);
  for (const bad of [
    new URL(attempt.redirect + "?state=wrong&code=x"),
    new URL(attempt.redirect + `?state=${attempt.state}&error=access_denied`),
  ])
    await assert.rejects(exchangeCode(attempt, bad, mock, keys));
  assert.equal(exchanged, 1);
  await assert.rejects(validateIdentity(idToken, "oaiapp_other", attempt.nonce, undefined, keys));
  await assert.rejects(validateIdentity(idToken, saved.client_id, "other", undefined, keys));
  await assert.rejects(
    validateIdentity(idToken, saved.client_id, attempt.nonce, "other-sub", keys),
  );
  const expired = await new SignJWT({ nonce: attempt.nonce })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(issuer)
    .setAudience(saved.client_id)
    .setSubject(saved.subject)
    .setIssuedAt()
    .setExpirationTime(1)
    .sign(privateKey);
  await assert.rejects(validateIdentity(expired, saved.client_id, attempt.nonce, undefined, keys));
  const wrongIssuer = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("https://evil.invalid")
    .setAudience(saved.client_id)
    .setSubject(saved.subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  await assert.rejects(validateIdentity(wrongIssuer, saved.client_id, undefined, undefined, keys));
  const other = await generateKeyPair("RS256");
  await assert.rejects(
    validateIdentity(
      idToken,
      saved.client_id,
      attempt.nonce,
      undefined,
      async () => other.publicKey,
    ),
  );
  await assert.rejects(
    exchangeCode(
      attempt,
      callback,
      async () =>
        Response.json({
          access_token: "a",
          refresh_token: "r",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid profile email",
        }),
      keys,
    ),
    /权限/,
  );
  const returning = { ...attempt, clientId: saved.client_id, subject: saved.subject };
  await assert.rejects(
    exchangeCode(
      returning,
      new URL(callback.toString().replace(saved.client_id, "oaiapp_other")),
      mock,
      keys,
    ),
    /不匹配/,
  );
});
test("transfer encryption is randomized, authenticated and contains no host identity", () => {
  const secret = "random-fixture-transfer-key-32-characters";
  const plain = JSON.stringify(saved),
    a = protectTransfer(plain, secret),
    b = protectTransfer(plain, secret);
  assert.notEqual(a, b);
  assert(!a.includes(saved.access_token));
  assert.equal(unprotectTransfer(a, secret), plain);
  assert.throws(() => unprotectTransfer(a, "different-fixture-transfer-key-32-characters"));
  assert.throws(() => unprotectTransfer(a.slice(0, -5), secret));
  assert.throws(() => protectTransfer(plain, "short"));
  assert(!("ext_agent_host_id" in saved));
});
test("Responses maps instructions, images and full read/repair history, omitting unsupported fields", () => {
  const body = responsesBody("m", [
    { role: "system", content: "instructions" },
    {
      role: "user",
      content: [
        { type: "text", text: "image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,fixture" } },
      ],
    },
    { role: "assistant", content: '{"reads":[{}]}' },
    { role: "user", content: "actual tool result" },
  ]);
  assert.deepEqual(Object.keys(body).sort(), ["input", "instructions", "model", "store", "stream"]);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.match(body.instructions, /instructions/);
  assert.equal(body.input.length, 3);
  assert.deepEqual(body.input[0].content, [
    { type: "input_text", text: "image" },
    { type: "input_image", image_url: "data:image/png;base64,fixture" },
  ]);
  assert.equal(body.input[2].content, "actual tool result");
});
test("SSE handles fragmented UTF-8 and CRLF; partial/quota/error/incomplete/malformed streams cannot succeed", async () => {
  assert.equal(await readResponsesStream(completed('{"reply":"香港"}')), '{"reply":"香港"}');
  for (const terminal of ["response.incomplete", "response.failed", "error"])
    await assert.rejects(
      readResponsesStream(
        stream(
          frame({ type: "response.output_text.delta", delta: '{"ok":true}' }) +
            frame({
              type: terminal,
              response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
              code: "subscription_sharing_usage_limit_exceeded",
            }),
        ),
      ),
      /额度不足/,
    );
  await assert.rejects(
    readResponsesStream(stream(frame({ type: "response.output_text.delta", delta: "partial" }))),
  );
  await assert.rejects(readResponsesStream(stream("data: {malformed}\n\n")));
  await assert.rejects(
    readResponsesStream(
      stream(frame({ type: "response.completed", response: { status: "incomplete" } })),
    ),
  );
});
test("subscription transport executes a permission-controlled read with real graph history, never API fallback", async () => {
  let requests = 0,
    fallback = 0,
    revoked = 0,
    mode = "ok";
  const adapter = loadModule<typeof import("../../lib/ai-model")>(
    new URL("../../lib/ai-model.ts", import.meta.url),
    {
      "./ai-http": {
        aiFetch: async () => {
          fallback++;
          throw Error("billable fallback");
        },
      },
      "./chatgpt-oauth": oauth,
      "./chatgpt": {
        chatGptToken: async () => "synthetic-token",
        markChatGptUnauthorized: async () => {
          revoked++;
        },
      },
    },
    {
      fetch: async (url: string, options: RequestInit) => {
        assert.equal(url, resource + "/responses");
        assert.equal(
          (options.headers as Record<string, string>).Authorization,
          "Bearer synthetic-token",
        );
        const body = JSON.parse(options.body as string);
        assert.equal(body.stream, true);
        assert.equal(body.store, false);
        if (mode === "quota")
          return Response.json(
            { error: { code: "subscription_sharing_usage_limit_exceeded" } },
            { status: 429 },
          );
        if (mode === "invalid") return Response.json({}, { status: 401 });
        if (mode === "ineligible")
          return Response.json(
            { error: { code: "subscription_sharing_user_not_eligible" } },
            { status: 403 },
          );
        if (++requests === 1) return completed('{"reads":[{"module":"entries","query":"Quant"}]}');
        if (mode === "denied") {
          assert.match(body.input.at(-1).content, /权限/);
          return completed('{"reply":"权限已撤销，未读取"}');
        }
        assert.match(body.input.at(-1).content, /Quant fixture/);
        return completed('{"reply":"已读取 Quant fixture"}');
      },
    },
  );
  let reads = 0,
    enabled = true;
  const result = await runModelGraph(
    [
      { role: "system", content: "JSON reads" },
      { role: "user", content: "read fixture" },
    ],
    {
      call: (messages) => adapter.callAiModel(config, messages),
      read: async () => {
        assertAgentCommand(agentPolicy({ enabled, mode: "personal" }), "entries");
        reads++;
        return { title: "Quant fixture" };
      },
      prepare: (raw) => raw as { reply: string },
    },
  );
  assert.equal(result.reply, "已读取 Quant fixture");
  assert.equal(reads, 1);
  assert.equal(requests, 2);
  enabled = false;
  mode = "denied";
  requests = 0;
  const denied = await runModelGraph([{ role: "user", content: "read after revocation" }], {
    call: (messages) => adapter.callAiModel(config, messages),
    read: async () => {
      assertAgentCommand(agentPolicy({ enabled, mode: "personal" }), "entries");
      reads++;
      return {};
    },
    prepare: (raw) => raw as { reply: string },
  });
  assert.equal(denied.reply, "权限已撤销，未读取");
  assert.equal(reads, 1);
  for (const failure of ["quota", "invalid", "ineligible"]) {
    mode = failure;
    await assert.rejects(adapter.callAiModel(config, []), /ChatGPT/);
  }
  assert.equal(revoked, 1);
  assert.equal(fallback, 0);
  assert(isAiConfigured(config));
  assert(!isAiConfigured({ ...config, subscriptionReady: false }));
  assert.equal(publicAiConfig(config).hasKey, false);
  assert(!JSON.stringify(publicAiConfig(config)).includes("synthetic-token"));
});
