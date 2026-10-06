import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createHash, randomUUID } from "node:crypto";
if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw Error("Use the disposable database runner");
const { pool, controlPool, runAsUser, atomicAgentWrite } = await import("../lib/postgres");
const { executeAgentDraft } = await import("../lib/agent-executor");
const { blankEntry } = await import("../lib/model");
const { saveEntry, getEntry } = await import("../lib/entries");
const { localFiles } = await import("../lib/files");
const owner = randomUUID();
await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'transaction fixture')", [
  owner,
]);
after(() => pool.end());
const image = {
  id: "source",
  name: "fixture.png",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xAAAAABJRU5ErkJggg==",
};

async function proposal() {
  const run = randomUUID(),
    id = randomUUID();
  await pool.query("INSERT INTO agent_runs(id,owner_id,input) VALUES($1,$2,'{}')", [run, owner]);
  const entry = { ...blankEntry("job"), title: "Transaction fixture " + id };
  const draft = {
    id,
    title: "Save with screenshot",
    command: "entries" as const,
    body: { action: "save", entry },
    changes: [],
    sourceImageIds: [image.id],
  };
  return {
    run,
    draft,
    entry,
    fileId:
      "ag_" +
      createHash("sha256")
        .update(id + ":" + image.id)
        .digest("hex"),
    decision: { proposalId: id, approved: true, allowDuplicate: false },
  };
}

test("inherited domain writes roll back and serializable retries do not double-apply", () =>
  runAsUser(owner, async () => {
    const entry = (await saveEntry({ ...blankEntry("job"), title: "Before" })).entry;
    await assert.rejects(
      atomicAgentWrite(async () => {
        await saveEntry({ ...entry, title: "Must roll back" });
        await pool.query("INSERT INTO meta(key,value) VALUES('atomic-test','bad')");
        throw Error("after-write");
      }),
      /after-write/,
    );
    assert.equal((await getEntry(entry.id))!.title, "Before");
    assert.equal((await pool.query("SELECT 1 FROM meta WHERE key='atomic-test'")).rowCount, 0);
    let attempts = 0;
    await atomicAgentWrite(async (client) => {
      attempts++;
      await saveEntry({ ...entry, title: "After retry" });
      if (attempts === 1)
        await client.query(
          "DO $$ BEGIN RAISE EXCEPTION 'forced serialization failure' USING ERRCODE='40001'; END $$",
        );
    });
    assert.equal(attempts, 2);
    assert.equal((await getEntry(entry.id))!.revision, entry.revision + 1);
  }));

test("late receipt failure preserves bytes for retry, then concurrent/replayed confirmations write once", () =>
  runAsUser(owner, async () => {
    const p = await proposal();
    await pool.query(
      "CREATE FUNCTION fail_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'late receipt failure'; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_test_receipt BEFORE INSERT ON agent_operations FOR EACH ROW EXECUTE FUNCTION fail_test_receipt()",
    );
    try {
      await assert.rejects(
        executeAgentDraft(p.run, p.draft, p.decision, [image]),
        /late receipt failure/,
      );
    } finally {
      await pool.query("DROP TRIGGER fail_test_receipt ON agent_operations");
      await pool.query("DROP FUNCTION fail_test_receipt()");
    }
    assert.equal(await getEntry(p.entry.id), null);
    assert.equal((await pool.query("SELECT 1 FROM files WHERE id=$1", [p.fileId])).rowCount, 0);
    assert.equal(
      (await pool.query("SELECT 1 FROM agent_operations WHERE id=$1", [p.draft.id])).rowCount,
      0,
    );
    const published = await localFiles.get(p.fileId);
    assert.deepEqual(
      Buffer.from(published!.body),
      Buffer.from(image.dataUrl.split(",")[1], "base64"),
    );
    const outcomes = await Promise.all([
      executeAgentDraft(p.run, p.draft, p.decision, [image]),
      executeAgentDraft(p.run, p.draft, p.decision, [image]),
    ]);
    assert.deepEqual(outcomes[0], outcomes[1]);
    assert.equal((await getEntry(p.entry.id))!.revision, 1);
    assert.equal((await pool.query("SELECT 1 FROM files WHERE id=$1", [p.fileId])).rowCount, 1);
    assert.equal(
      (await pool.query("SELECT 1 FROM agent_operations WHERE id=$1", [p.draft.id])).rowCount,
      1,
    );
    assert.deepEqual(
      await executeAgentDraft(p.run, { ...p.draft, body: null }, p.decision),
      outcomes[0],
      "uncertain clients recover via receipt without re-reading images",
    );
  }));
