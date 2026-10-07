import assert from "node:assert/strict";
import { test } from "node:test";
import { loadModule } from "../helpers/load-module";

test("desk and backup authentication outages return retryable JSON, not expired sessions", async () => {
  let unavailable = true;
  let loggedIn = true;
  const dependencies = {
    zod: await import("zod"),
    "@/lib/auth": {
      getUser: async () => {
        if (unavailable) throw Error("injected authentication database outage");
        return loggedIn ? { userId: "fixture", displayName: "Fixture" } : null;
      },
    },
    "@/lib/session": { validOrigin: () => false },
    "@/lib/postgres": {},
    "@/lib/attachments": {},
    "@/lib/files": {},
    "@/lib/entries": {},
    "@/lib/watch-storage": {},
    "@/lib/directory-storage": {},
    "@/lib/enrichment": {},
    "@/lib/reminders": {},
    "@/lib/reminder-preferences": {},
    "@/lib/backup": {},
  };
  type Route = {
    GET?: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  const globals = { Response, console: { error: () => {} } };
  const desk = loadModule<Route>(
    new URL("../../app/api/desk/route.ts", import.meta.url),
    dependencies,
    globals,
  );
  const backup = loadModule<Route>(
    new URL("../../app/api/backup/route.ts", import.meta.url),
    dependencies,
    globals,
  );
  for (const route of [desk.GET!, desk.POST, backup.POST]) {
    const response = await route(new Request("https://example.test/api", { method: "POST" }));
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type")!, /application\/json/);
    assert.match((await response.json()).error, /稍后重试/);
  }
  unavailable = false;
  loggedIn = false;
  for (const route of [desk.GET!, desk.POST, backup.POST])
    assert.equal((await route(new Request("https://example.test/api"))).status, 401);
  loggedIn = true;
  for (const route of [desk.POST, backup.POST])
    assert.equal((await route(new Request("https://example.test/api"))).status, 403);
});
