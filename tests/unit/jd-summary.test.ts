import assert from "node:assert/strict";
import test from "node:test";
import * as crypto from "node:crypto";
import { loadModule } from "../helpers/load-module";
import * as contract from "../../lib/jd-summary";
import { agentPolicy, assertAgentCommand } from "../../lib/agent-policy";
import { blankEntry } from "../../lib/model";
import { jd, summary } from "../fixtures/jd-summary";

function fixture() {
  const entry = {
    ...blankEntry("job"),
    title: "Fixture",
    status: "二面",
    applied: "2026-10-01",
    jd,
  };
  const values = new Map<string, string>();
  let calls = 0,
    enabled = true,
    afterModel = () => {};
  const service = loadModule<typeof import("../../lib/jd-summary-service")>(
    new URL("../../lib/jd-summary-service.ts", import.meta.url),
    {
      "node:crypto": crypto,
      "./jd-summary": contract,
      "./ai-client": {
        aiJson: async (_task: string, prompt: string, input: string) => {
          calls++;
          assert.equal(input, entry.jd);
          for (const requirement of ["必备", "加分", "滚动", "多轮", "毕业", "不可信", "不能推断"])
            assert(
              prompt.includes(requirement) ||
                (requirement === "不能推断" && prompt.includes("绝不推断")),
            );
          afterModel();
          return structuredClone(summary);
        },
      },
      "./ai-config": {
        getAiConfig: async () => ({
          enabled,
          base: "mock",
          key: "mock",
          model: "mock",
          mode: "personal",
        }),
      },
      "./agent-policy": { agentPolicy, assertAgentCommand },
      "./entries": {
        getEntry: async (id: string) => (id === entry.id ? structuredClone(entry) : null),
        listEntries: async () => [structuredClone(entry)],
      },
      "./postgres": {
        currentUserId: async () => "owner",
        pool: {
          connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }),
          query: async (sql: string, args: string[]) => {
            if (sql.startsWith("SELECT value"))
              return { rows: values.has(args[0]) ? [{ value: values.get(args[0]) }] : [] };
            assert(sql.startsWith("INSERT INTO meta"), "must never write entries or progress");
            values.set(args[0], args[1]);
            return { rows: [] };
          },
        },
      },
    },
  );
  return {
    entry,
    values,
    service,
    calls: () => calls,
    onModel: (fn: () => void) => {
      afterModel = fn;
    },
    disable: () => {
      enabled = false;
    },
  };
}

test("structured JD preserves nuanced source points and rejects invented quotations or fields", () => {
  const result = contract.groundJdSummary(
    { ...summary, preferred: [...summary.preferred, ...summary.preferred] },
    jd,
  );
  assert.equal(result.preferred.length, 1);
  assert.equal(result.required.length, 1);
  assert.equal(result.deadlines.length, 3);
  assert.equal(result.responsibilities.length, 2);
  assert.throws(
    () =>
      contract.groundJdSummary(
        { ...summary, locations: [{ text: "远程", quote: "Remote work" }] },
        jd,
      ),
    /引用/,
  );
  assert.throws(() => contract.groundJdSummary({ ...summary, status: "已投递" }, jd));
});
test("automatic JD generation is idempotent, source-bound and never changes actual application data", async () => {
  const f = fixture(),
    original = structuredClone(f.entry);
  await f.service.processJdSummaries();
  await f.service.processJdSummaries();
  await f.service.generateJdSummary(f.entry.id);
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.entry, original);
  assert.deepEqual((await f.service.readJdSummary(f.entry.id)).summary, summary);
  f.entry.jd += "\nNew source.";
  assert.equal((await f.service.readJdSummary(f.entry.id)).status, "pending");
  await f.service.processJdSummaries();
  assert.equal(f.calls(), 2);
  assert.equal((await f.service.readJdSummary("another-owner-record")).status, "missing");
});
test("changed source and revoked permissions during generation cannot publish stale results", async () => {
  const f = fixture();
  f.onModel(() => {
    f.entry.jd += "\nChanged during model call.";
  });
  assert.equal((await f.service.generateJdSummary(f.entry.id)).status, "pending");
  assert.equal(f.values.size, 0);
  f.onModel(f.disable);
  await assert.rejects(f.service.generateJdSummary(f.entry.id), /权限/);
  assert.equal(f.values.size, 0);
});
