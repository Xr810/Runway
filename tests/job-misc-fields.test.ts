import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";

if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw Error("Use the disposable database runner");
const { pool, controlPool, runAsUser, tx } = await import("../lib/postgres");
const { blankEntry } = await import("../lib/model");
const { saveEntry, restoreVersions, listVersions, getEntry, undeleteEntry } = await import(
  "../lib/entries"
);
const { readBackup, restoreBackup } = await import("../lib/backup");
const owners = [randomUUID(), randomUUID()];
for (const owner of owners)
  await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,'misc fixture')", [
    owner,
  ]);
after(() => pool.end());
const misc = { notes: "Old fixture notes", extra: { imported: "Old fixture" } };
const migration = await readFile(
  new URL("../scripts/migrations/0013_retire_job_misc_fields.sql", import.meta.url),
  "utf8",
);

test("cleanup covers both tenants, trash and partial history, bumps revisions once, and rejects stale saves", async () => {
  const fixtures = owners.map(() =>
    ["job", "job", "project", "competition"].map((kind) => ({
      ...blankEntry(kind as "job" | "project" | "competition"),
      ...misc,
      title: "Migration fixture",
      jd: "Keep original",
      companyDescription: "Keep company",
      revision: 4,
    })),
  );
  await runAsUser(owners[0], () =>
    tx(async (db) => {
      await db.query("ALTER TABLE entries DISABLE TRIGGER retire_job_misc_fields");
      await db.query("ALTER TABLE versions DISABLE TRIGGER retire_job_misc_fields");
      for (const [index, owner] of owners.entries()) {
        await db.query("SELECT set_config('runway.user_id',$1,true)", [owner]);
        for (const [i, entry] of fixtures[index].entries()) {
          await db.query(
            "INSERT INTO entries(id,data,revision,updated,deleted_at) VALUES($1,$2,4,now(),$3)",
            [entry.id, JSON.stringify(entry), i === 1 ? new Date().toISOString() : null],
          );
          await db.query("INSERT INTO versions(id,entry_id,data,created) VALUES($1,$2,$3,now())", [
            randomUUID(),
            entry.id,
            JSON.stringify({ jd: "Partial legacy history", ...misc }),
          ]);
        }
      }
      await db.query(migration);
      await db.query(migration);
    }),
  );
  for (const [index, owner] of owners.entries())
    await runAsUser(owner, async () => {
      for (const [i, old] of fixtures[index].entries()) {
        const row = (
          await pool.query("SELECT data,revision,deleted_at FROM entries WHERE id=$1", [old.id])
        ).rows[0];
        assert.equal(row.revision, old.kind === "job" ? 5 : 4);
        assert.equal(row.data.revision, row.revision);
        assert.equal(row.data.jd, "Keep original");
        assert.equal(row.data.companyDescription, "Keep company");
        assert.equal(Boolean(row.deleted_at), i === 1);
        assert.equal(row.data.notes, old.kind === "job" ? "" : misc.notes);
        assert.deepEqual(row.data.extra, old.kind === "job" ? {} : misc.extra);
        const version = (await listVersions(old.id, true))[0];
        assert.ok("data" in version);
        const history = JSON.parse(version.data);
        assert.deepEqual(
          history,
          old.kind === "job"
            ? { jd: "Partial legacy history" }
            : { jd: "Partial legacy history", ...misc },
        );
      }
      await assert.rejects(saveEntry(fixtures[index][0]), /已更新/);
      await undeleteEntry(fixtures[index][1].id);
      assert.equal((await getEntry(fixtures[index][1].id))!.notes, "");
      assert.equal(await getEntry(fixtures[1 - index][0].id), null);
    });
});

test("backup and direct history restore cannot reintroduce job misc fields", async () => {
  const job = { ...blankEntry("job"), title: "Backup fixture", ...misc };
  const project = { ...blankEntry("project"), title: "Project backup", ...misc };
  const versions = [job, project].map((e) => ({
    id: randomUUID(),
    entry_id: e.id,
    data: JSON.stringify({ jd: "Keep history", ...misc }),
    created: new Date().toISOString(),
  }));
  const bytes = zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        format: "opportunity-desk-v1",
        entries: [job, project],
        files: [],
        versions,
      }),
    ),
  });
  const backup = await readBackup(new Blob([bytes as BlobPart]).stream());
  await runAsUser(owners[0], async () => {
    await restoreBackup(backup);
    await restoreBackup(backup);
    await restoreVersions(versions.map((v) => ({ ...v, id: randomUUID() })));
    assert.equal((await getEntry(job.id))!.notes, "");
    assert.equal((await getEntry(project.id))!.notes, misc.notes);
    for (const entry of [job, project]) {
      const raw = (await pool.query("SELECT data FROM entries WHERE id=$1", [entry.id])).rows[0]
        .data;
      assert.deepEqual(raw.extra, entry.kind === "job" ? {} : misc.extra);
      for (const version of await listVersions(entry.id, true)) {
        assert.ok("data" in version);
        assert.deepEqual(
          JSON.parse(version.data),
          entry.kind === "job" ? { jd: "Keep history" } : { jd: "Keep history", ...misc },
        );
      }
    }
  });
});
