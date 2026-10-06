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
      const summaries = await listSummaries();
      timings.push(performance.now() - start);
      assert.equal(summaries.length, 100);
      assert.ok(
        summaries.every((e) => e.jd === "" && e.jdChars === 50000 && e.jdStatus === "complete"),
      );
    }
    const entries = await listEntries();
    const summaries = await listSummaries();
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
    await assert.rejects(listSummaries(), /完整存档必须包含正文/);
  });
});
