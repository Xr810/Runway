import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createSession, ownerId, validSession } from "../../lib/session";

test("stable configured owner preserves legacy sessions and rejects other owners", () => {
  const oldOwner = process.env.OWNER_ID, oldSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "test-secret-only".repeat(4);
    delete process.env.OWNER_ID;
    const defaultToken = createSession(3);
    assert.equal(ownerId(), "owner");
    assert(validSession(defaultToken, 3));
    process.env.OWNER_ID = "legacy-account";
    const payload = Buffer.from(JSON.stringify({ sub: "legacy-account", exp: Math.floor(Date.now() / 1000) + 3600, ver: 3 })).toString("base64url");
    const signature = createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
    assert(validSession(payload + "." + signature, 3));
    assert(validSession(createSession(3), 3));
    assert(!validSession(defaultToken, 3));
    assert(!validSession(payload + "." + signature, 4));
  } finally {
    if (oldOwner === undefined) delete process.env.OWNER_ID; else process.env.OWNER_ID = oldOwner;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
  }
});
