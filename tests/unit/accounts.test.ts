import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, normalizeEmail, validNewPassword, verifyPassword } from "../../lib/accounts";

test("account credentials are normalized, bounded, salted, and verified", async () => {
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail("invalid"), null);
  assert.equal(validNewPassword("short"), false);
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword("anything", "broken"), false);
});
