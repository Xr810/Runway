import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { z } from "zod";
import { pairingClient } from "../../lib/chatgpt-pairing-client";
import { ChatGptError } from "../../lib/chatgpt-oauth";
import { loadModule } from "../helpers/load-module";

test("helper accepts only explicit HTTPS pairing endpoints and never forwards secrets on redirects", async () => {
  const code = "https://runway.example/api/settings/chatgpt/pair#iv.tag.ticket";
  for (const invalid of [
    code.replace("https:", "http:"),
    code.replace("runway.example", "user:pass@runway.example"),
    code.replace("/pair#", "/pair?token=x#"),
    code.replace("/pair#", "/other#"),
    code.replace("#iv.tag.ticket", ""),
  ])
    assert.throws(() => pairingClient(invalid), /格式无效/);
  let calls = 0;
  const client = pairingClient(code, async (url, options) => {
    calls++;
    assert.equal(String(url), "https://runway.example/api/settings/chatgpt/pair");
    assert.equal(options!.redirect, "error");
    assert.equal(new Headers(options!.headers).get("authorization"), "Bearer iv.tag.ticket");
    assert(!String(options!.body).includes("ticket"));
    throw Error("redirect to attacker");
  });
  await assert.rejects(
    client.request({ action: "start", host: "host", port: 55432 }),
    /结果不确定/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    pairingClient(code, async () => Response.json({ connected: false })).request({
      action: "finish",
      callback: "synthetic",
    }),
    /未确认/,
  );
});

test("pair endpoint rejects missing tickets, caller-owned identity, malformed and oversized bodies", async () => {
  let calls = 0;
  const route = loadModule<typeof import("../../app/api/settings/chatgpt/pair/route")>(
    new URL("../../app/api/settings/chatgpt/pair/route.ts", import.meta.url),
    {
      zod: { z },
      "@/lib/chatgpt-oauth": { ChatGptError },
      "@/lib/postgres": {
        runAsUser: (owner: string, work: () => unknown) => {
          assert.equal(owner, "ticket-owner");
          return work();
        },
      },
      "@/lib/chatgpt": {
        chatGptPairingOwner: (ticket: string) => {
          if (ticket !== "valid") throw Error();
          return "ticket-owner";
        },
        processChatGptPairing: async () => {
          calls++;
          return { connected: true };
        },
      },
    },
  );
  const body = {
    action: "start",
    host: "urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    port: 55432,
  };
  const request = (value: unknown, ticket = "valid") =>
    new Request("https://runway.example/api/settings/chatgpt/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ticket}` },
      body: JSON.stringify(value),
    });
  assert.equal((await route.POST(request(body, "invalid"))).status, 401);
  assert.equal((await route.POST(request({ ...body, owner: "attacker" }))).status, 400);
  assert.equal((await route.POST(request({ ...body, port: 0 }))).status, 400);
  assert.equal(
    (await route.POST(request({ action: "finish", callback: "x".repeat(17000) }))).status,
    413,
  );
  assert.equal(calls, 0);
  const response = await route.POST(request(body));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(calls, 1);
});

test("generating a pairing code requires login, same origin, live policy and HTTPS", async () => {
  let loggedIn = true,
    sameOrigin = true,
    allowed = true,
    origin = "https://runway.example",
    created = 0;
  const route = loadModule<typeof import("../../app/api/settings/chatgpt/route")>(
    new URL("../../app/api/settings/chatgpt/route.ts", import.meta.url),
    {
      zod: { z },
      "@/lib/auth": { getUser: async () => (loggedIn ? { userId: "fixture-owner" } : null) },
      "@/lib/session": { appOrigin: () => origin, validOrigin: () => sameOrigin },
      "@/lib/ai-config": {},
      "@/lib/ai-model": {},
      "@/lib/rate-limit": { hit: async () => true },
      "@/lib/chatgpt-oauth": { ChatGptError },
      "@/lib/chatgpt": {
        assertChatGptPolicy: async () => {
          if (!allowed) throw Error();
        },
        createChatGptPairing: async () => {
          created++;
          return { ticket: "fixture", expiresAt: 123, id: "attempt" };
        },
      },
    },
  );
  const request = () =>
    new Request("https://runway.example/api/settings/chatgpt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pair" }),
    });
  loggedIn = false;
  assert.equal((await route.POST(request())).status, 401);
  loggedIn = true;
  sameOrigin = false;
  assert.equal((await route.POST(request())).status, 403);
  sameOrigin = true;
  allowed = false;
  assert.equal((await route.POST(request())).status, 403);
  allowed = true;
  origin = "http://runway.example";
  assert.equal((await route.POST(request())).status, 400);
  assert.equal(created, 0);
  origin = "https://runway.example";
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    pairing: origin + "/api/settings/chatgpt/pair#fixture",
    expiresAt: 123,
    pairingId: "attempt",
  });
  assert.equal(created, 1);
});

test(
  "desktop helper handles loopback callback, rejects wrong state, completes once and writes no tokens",
  { skip: process.platform !== "linux" },
  async () => {
    const root = await mkdtemp(tmpdir() + "/runway-pair-helper-");
    try {
      // Real CLI and local HTTP listener; only Runway HTTPS and the system opener are synthetic.
      await writeFile(
        root + "/preload.mjs",
        `
      import {appendFileSync} from 'node:fs';
      globalThis.fetch = async (url, init) => {
        if (String(url) !== 'https://runway.example/api/settings/chatgpt/pair') throw Error('wrong endpoint');
        if (init.redirect !== 'error' || init.headers.Authorization !== 'Bearer iv.tag.ticket') throw Error('wrong transport');
        const input = JSON.parse(init.body);
        appendFileSync(${JSON.stringify(root + "/calls")}, input.action + '\\n');
        if (input.action === 'start') {
          const url = new URL('https://auth.openai.com/api/accounts/authorize');
          url.searchParams.set('redirect_uri', 'http://127.0.0.1:' + input.port + '/auth/callback');
          url.searchParams.set('state', 'fixture-state');
          return Response.json({url: String(url)});
        }
        const callback = new URL(input.callback);
        if (callback.searchParams.get('code') !== 'fixture-code' || callback.searchParams.get('state') !== 'fixture-state') throw Error('wrong callback');
        return Response.json({connected: true});
      };
    `,
      );
      await writeFile(
        root + "/xdg-open",
        `#!/usr/bin/env node
      const assert = require('node:assert/strict');
      (async () => {
        const auth = new URL(process.argv[2]);
        const callback = new URL(auth.searchParams.get('redirect_uri'));
        callback.search = '?state=wrong&code=fixture-code';
        assert.equal((await fetch(callback)).status, 400);
        callback.searchParams.set('state', auth.searchParams.get('state'));
        const response = await fetch(callback);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Runway 已连接 ChatGPT/);
      })().catch(() => process.exit(1));
    `,
        { mode: 0o700 },
      );
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            root + "/preload.mjs",
            "--import",
            "tsx",
            "scripts/chatgpt.ts",
            "connect",
            "--host-file",
            root + "/host",
          ],
          { env: { ...process.env, PATH: root + ":" + process.env.PATH }, stdio: "pipe" },
        );
        let output = "",
          paired = false,
          confirmed = false;
        const timeout = setTimeout(() => {
          child.kill();
          reject(Error("helper test timed out"));
        }, 15000);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (!paired && output.includes("粘贴 Runway")) {
            paired = true;
            child.stdin.write("https://runway.example/api/settings/chatgpt/pair#iv.tag.ticket\n");
          }
          if (!confirmed && output.includes("输入 yes")) {
            confirmed = true;
            child.stdin.write("yes\n");
          }
        });
        child.stderr.on("data", (chunk) => {
          output += chunk;
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          clearTimeout(timeout);
          if (code === 0) resolve(output);
          else reject(Error(output));
        });
      });
      assert.match(output, /本机未保存 token/);
      assert(!output.includes("fixture-code"));
      assert.equal(await readFile(root + "/calls", "utf8"), "start\nfinish\n");
      assert.deepEqual((await readdir(root)).sort(), ["calls", "host", "preload.mjs", "xdg-open"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
