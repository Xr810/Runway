import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";

if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw Error("Use the disposable database runner");
const { pool, controlPool, runAsUser } = await import("../lib/postgres");
const { blankEntry } = await import("../lib/model");
const { listEntries, listSummaries, saveEntry } = await import("../lib/entries");
const owner = randomUUID();
await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'read fixture')", [owner]);
after(() => pool.end());

test("summary read baseline preserves full-JD validation and UTF-16 counts", async (t) => {
  await runAsUser(owner, async () => {
    const jd = "岗位😀\n".repeat(10000); // 50,000 UTF-16 units, not 40,000 SQL characters.
    for (let i = 0; i < 100; i++)
      await saveEntry({
        ...blankEntry("job"),
        title: `Read fixture ${i}`,
        jd,
        jdStatus: "complete",
      });
    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const { entries: summaries, entryReadIssues } = await listSummaries();
      assert.deepEqual(entryReadIssues, []);
      timings.push(performance.now() - start);
      assert.equal(summaries.length, 100);
      assert.ok(
        summaries.every((e) => e.jd === "" && e.jdChars === 50000 && e.jdStatus === "complete"),
      );
    }
    const entries = await listEntries();
    const { entries: summaries } = await listSummaries();
    t.diagnostic(
      JSON.stringify({
        records: 100,
        jdCharsEach: 50000,
        fullJsonBytes: Buffer.byteLength(JSON.stringify(entries)),
        summaryJsonBytes: Buffer.byteLength(JSON.stringify(summaries)),
        summaryMedianMs: Number(timings.sort((a, b) => a - b)[2].toFixed(2)),
      }),
    );
    // A projection must not accidentally make corrupt complete archives look valid.
    await pool.query("UPDATE entries SET data=jsonb_set(data,'{jd}', '\"\"'::jsonb) WHERE id=$1", [
      entries[0].id,
    ]);
    const partial = await listSummaries();
    assert.equal(partial.entries.length, 99);
    assert.deepEqual(partial.entryReadIssues, [{ id: entries[0].id, paths: ["$"] }]);
    await assert.rejects(listEntries(), /记录校验失败/);
  });
});

test("empty optional endsAt is compatible; invalid rows are isolated without data loss or content logs", async (t) => {
  const user = randomUUID();
  await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'date fixture')", [
    user,
  ]);
  const warn = t.mock.method(console, "warn", () => {});
  await runAsUser(user, async () => {
    const saved = [];
    for (let i = 0; i < 3; i++)
      saved.push(
        (
          await saveEntry({
            ...blankEntry("job"),
            title: `Private title ${i}`,
            appointments: [
              { id: "stage", title: "Private stage", type: "assessment", startsAt: "" },
            ],
          })
        ).entry,
      );
    await pool.query(
      "UPDATE entries SET data=jsonb_set(data,'{appointments,0,endsAt}', '\"\"'::jsonb) WHERE id=$1",
      [saved[1].id],
    );
    const compatible = await listEntries();
    assert.equal(compatible.length, 3);
    assert(compatible.every((entry) => entry.appointments[0].endsAt === undefined));
    await pool.query(
      "UPDATE entries SET data=jsonb_set(data,'{appointments,0,endsAt}', '\"invalid-private-date\"'::jsonb) WHERE id=$1",
      [saved[2].id],
    );
    const before = (
      await pool.query("SELECT data,revision FROM entries WHERE id=$1", [saved[2].id])
    ).rows[0];
    const result = await listSummaries();
    assert.deepEqual(
      result.entries.map((entry) => entry.id).sort(),
      [saved[0].id, saved[1].id].sort(),
    );
    assert.deepEqual(result.entryReadIssues, [
      { id: saved[2].id, paths: ["appointments.0.endsAt"] },
    ]);
    await assert.rejects(listEntries(), /记录校验失败/);
    assert.deepEqual(
      (await pool.query("SELECT data,revision FROM entries WHERE id=$1", [saved[2].id])).rows[0],
      before,
    );
    const logged = JSON.stringify(warn.mock.calls.map((call) => call.arguments));
    assert(logged.includes(saved[2].id));
    assert(logged.includes("appointments.0.endsAt"));
    assert(!logged.includes("Private") && !logged.includes("invalid-private-date"));
  });
});
