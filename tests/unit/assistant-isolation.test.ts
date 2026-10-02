import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantCacheDatabase } from "../../components/app/assistant-cache";

test("assistant browser cache is namespaced by authenticated account", () => {
  const accountA = "11111111-1111-4111-8111-111111111111";
  const accountB = "22222222-2222-4222-8222-222222222222";
  assert.notEqual(assistantCacheDatabase(accountA), assistantCacheDatabase(accountB));
  assert.equal(assistantCacheDatabase(accountA), assistantCacheDatabase(accountA));
});
