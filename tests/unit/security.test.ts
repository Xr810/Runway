import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SESSION_SECRET = "a".repeat(64);
process.env.APP_ORIGIN = "https://runway.example.com";
const { randomToken, tokenHash, validOrigin, sessionSeconds, clientIp, cookieOptions } = await import("../../lib/session");
const { normalizeBase, sealKey, openKey, publicAiConfig, resolveConfig } = await import("../../lib/ai-config");
const { publicAddress, checkEndpoint } = await import("../../lib/ai-http");
const { publicFetch } = await import("../../lib/web");

test("session tokens are opaque, hashed for storage, and cookies are hardened", () => {
  const session = randomToken();
  assert.match(session, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenHash(session).length, 32);
  assert.equal(sessionSeconds, 7 * 24 * 60 * 60);
  assert.deepEqual(cookieOptions(), { httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  assert.equal(validOrigin(new Request("http://internal/api", { headers: { origin: "https://runway.example.com" } })), true);
  assert.equal(validOrigin(new Request("http://internal/api", { headers: { origin: "https://evil.example", "x-forwarded-host": "runway.example.com" } })), false);
  assert.equal(clientIp(new Request("http://x/", { headers: { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" } })), "203.0.113.9");
});
test("AI keys use their own secret, and legacy ciphertexts still open", () => {
  delete process.env.AI_SETTINGS_KEY;
  const legacy = sealKey("only-for-this-test");
  assert.deepEqual(openKey(legacy), { value: "only-for-this-test", stale: false });
  process.env.AI_SETTINGS_KEY = "d".repeat(64);
  assert.deepEqual(openKey(legacy), { value: "only-for-this-test", stale: true }, "legacy value opens and is marked for re-sealing");
  const fresh = sealKey("only-for-this-test");
  assert.deepEqual(openKey(fresh), { value: "only-for-this-test", stale: false });
  process.env.SESSION_SECRET = "e".repeat(64);
  assert.equal(openKey(fresh).value, "only-for-this-test", "rotating the session secret no longer breaks the AI key");
  assert.throws(() => openKey(legacy));
  process.env.SESSION_SECRET = "a".repeat(64);
});
test("AI endpoints and settings are validated", async () => {
  assert.equal(normalizeBase(" https://example.com/v1/ "), "https://example.com/v1");
  for (const base of ["file:///etc/passwd", "https://u:p@example.com", "https://example.com?key=secret", "https://example.com/v1/models"]) assert.throws(() => normalizeBase(base));
  const config = { base: "https://example.com/v1", key: "secret-key", model: "a", revision: 4, source: "settings" as const };
  assert(!JSON.stringify(publicAiConfig(config)).includes("secret-key"));
  assert.throws(() => resolveConfig({ base: "https://other.example/v1", model: "b" }, config), /更换/);
  for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "::1", "fd00::1", "fe80::1"]) assert(!publicAddress(ip), ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert(publicAddress(ip), ip);
  await assert.rejects(() => checkEndpoint("https://127.0.0.1/v1"), /受限/);
  await assert.rejects(() => checkEndpoint("http://example.com/v1"), /HTTPS/);
});
test("the crawler only fetches public HTTPS addresses", async () => {
  await assert.rejects(() => publicFetch("http://example.com/"), /HTTPS/);
  await assert.rejects(() => publicFetch("https://127.0.0.1/"), /受限/);
  await assert.rejects(() => publicFetch("https://user:pass@example.com/"), /HTTPS/);
  await assert.rejects(() => publicFetch("https://example.com:8443/"), /HTTPS/);
});
