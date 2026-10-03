import { test } from "node:test";
import assert from "node:assert/strict";
import { searchQuery, searchTavily, shouldSearchWeb } from "../../lib/tavily";

test("Tavily search only runs for explicit web-search intent", () => {
  assert.equal(shouldSearchWeb("搜一下 M-Labs 香港团队"), true);
  assert.equal(shouldSearchWeb("帮我 websearch 一下香港的 mlabs 这家公司"), true);
  assert.equal(shouldSearchWeb("这个链接是什么岗位 https://example.com/job"), false);
  assert.equal(shouldSearchWeb("每天 8 点提醒我挖因子"), false);
  assert.equal(shouldSearchWeb("帮我把公司的图标都补上,你可以websearch"), false);
});

test("search query removes invocation words before sending it upstream", () => {
  assert.equal(searchQuery("搜一下mlabs,香港一个做科学仪器的公司"), "M-Labs 香港做科学仪器的公司");
  assert.equal(searchQuery("帮我 websearch 一下香港的 mlabs 这家公司"), "香港的 M-Labs");
});

test("Tavily results are normalized and bounded", async () => {
  const originalFetch = globalThis.fetch;
  const request: { value: { url: string; body: Record<string, unknown> } | null } = { value: null };
  globalThis.fetch = (async (url, init) => {
    request.value = { url: String(url), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ results: [{ title: "M-Labs", url: "https://m-labs.hk", content: "香港科学仪器公司", score: 0.9 }, { title: 12, url: "bad", content: null }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const results = await searchTavily("搜一下 M-Labs 香港团队", "test-key");
    assert.equal(request.value?.url, "https://api.tavily.com/search");
    assert.equal(request.value?.body.query, "M-Labs 香港团队");
    assert.equal(request.value?.body.max_results, 5);
    assert.equal(request.value?.body.api_key, undefined);
    assert.deepEqual(results, [{ title: "M-Labs", url: "https://m-labs.hk/", content: "香港科学仪器公司", score: 0.9 }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("irrelevant search-engine explainers are discarded", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ results: [
    { title: "ChatGPT Search", url: "https://example.com/chatgpt", content: "如何使用 ChatGPT 搜索" },
    { title: "M-Labs", url: "https://m-labs.hk", content: "香港科学仪器公司" },
  ] }), { status: 200 })) as typeof fetch;
  try {
    const results = await searchTavily("搜一下 M-Labs 香港团队", "test-key");
    assert.deepEqual(results.map(result => result.title), ["M-Labs"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("ordinary in-product searches stay local until web search is explicit", () => {
  assert.equal(shouldSearchWeb("搜索后端岗位"), false);
  assert.equal(shouldSearchWeb("列出我的岗位"), false);
  assert.equal(shouldSearchWeb("查看今天的提醒"), false);
  assert.equal(shouldSearchWeb("联网搜索后端岗位"), true);
});
