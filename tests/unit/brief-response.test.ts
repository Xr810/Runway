import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../../lib/api-response";
import { briefSchema } from "../../lib/brief-contract";

test("brief accepts provider priority variants without weakening content validation", () => {
  const result = briefSchema.parse({ headline: "今天的建议", items: ["high", "normal", "medium", "low", undefined].map(priority => ({ text: "准备申请", priority })) });
  assert.deepEqual(result.items.map(i => i.priority), ["high", "normal", "normal", "normal", "normal"]);
  assert.equal(briefSchema.safeParse({ headline: "x", items: [{ text: "x", priority: "unknown" }] }).success, false);
  assert.equal(briefSchema.safeParse({ headline: "x", items: [{ priority: "medium" }] }).success, false);
});

test("proxy HTML errors are not labelled as expired sessions", async () => {
  for (const status of [403, 404, 429, 500, 502, 503, 504, 524]) {
    await assert.rejects(readJson(new Response("<html>proxy error</html>", { status, headers: { "content-type": "text/html" } })), error => error instanceof Error && !error.message.includes("登录已过期"));
  }
  await assert.rejects(readJson(new Response("unauthorized", { status: 401 })), /登录已过期/);
  const login = new Response("<html>Login</html>", { headers: { "content-type": "text/html" } });
  Object.defineProperties(login, { redirected: { value: true }, url: { value: "https://example.com/cdn-cgi/access/login/site" } });
  await assert.rejects(readJson(login), /登录已过期/);
});

test("JSON errors retain the backend explanation and malformed responses stay actionable", async () => {
  await assert.rejects(readJson(Response.json({ error: "生成失败：模型返回格式错误" }, { status: 502 })), /模型返回格式错误/);
  await assert.rejects(readJson(new Response("{broken", { headers: { "content-type": "application/json" } })), /无法解析/);
  assert.deepEqual(await readJson(Response.json({ brief: null })), { brief: null });
});
