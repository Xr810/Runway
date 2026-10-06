import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, test } from "node:test";

if (!process.env.DATABASE_URL)
  throw Error("DATABASE_URL is required for PostgreSQL integration tests");
process.env.AI_SETTINGS_KEY ||= "issue25-test-key-material-at-least-32-bytes";

const postgres = await import("../lib/postgres");
const { controlPool, pool, runAsUser, tx } = postgres;
const entries = await import("../lib/entries");
const { blankEntry } = await import("../lib/model");
const accounts = await import("../lib/accounts");
const integrations = await import("../lib/integrations");
const ai = await import("../lib/ai-config");
const { dispatchRecruitingRemindersForUser } = await import("../lib/recruiting-dispatch");
const { getReminderPreferences, saveReminderPreferences } = await import(
  "../lib/reminder-preferences"
);

const accountA = randomUUID(),
  accountB = randomUUID(),
  prefix = `issue25-${randomUUID().slice(0, 8)}`;
const as = <T>(id: string, work: () => T) => runAsUser(id, work);

await controlPool.query("INSERT INTO accounts(id,display_name) VALUES($1,$3),($2,$4)", [
  accountA,
  accountB,
  `${prefix}-a`,
  `${prefix}-b`,
]);

after(async () => {
  // Only rows owned by these disposable accounts are removed. RLS is deliberately
  // kept active during cleanup so a typo cannot delete another test's fixtures.
  for (const user of [accountA, accountB])
    await as(user, () =>
      tx(async (client) => {
        for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"])
          await client.query(`DELETE FROM runway_agent.${table}`);
        for (const table of [
          "agent_operations",
          "agent_jobs",
          "agent_runs",
          "integration_events",
          "integration_job_refs",
          "notifications",
          "versions",
          "files",
          "enrichment_results",
          "enrichment_tasks",
          "enrichment_state",
          "entries",
          "integration_clients",
          "ai_cache",
          "meta",
        ])
          await client.query(`DELETE FROM ${table}`);
      }),
    );
  await controlPool.query("DELETE FROM auth_sessions WHERE account_id=ANY($1::uuid[])", [
    [accountA, accountB],
  ]);
  await controlPool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [[accountA, accountB]]);
  await pool.end();
});

test("A and B can concurrently use identical meta and cache keys without seeing each other", async () => {
  await Promise.all([
    as(accountA, () => pool.query("INSERT INTO meta(key,value) VALUES('same-key','a')")),
    as(accountB, () => pool.query("INSERT INTO meta(key,value) VALUES('same-key','b')")),
    as(accountA, () =>
      pool.query("INSERT INTO ai_cache(key,value) VALUES('same-key',$1)", [{ owner: "a" }]),
    ),
    as(accountB, () =>
      pool.query("INSERT INTO ai_cache(key,value) VALUES('same-key',$1)", [{ owner: "b" }]),
    ),
  ]);
  assert.equal(
    (await as(accountA, () => pool.query("SELECT value FROM meta WHERE key='same-key'"))).rows[0]
      .value,
    "a",
  );
  assert.deepEqual(
    (await as(accountB, () => pool.query("SELECT value FROM ai_cache WHERE key='same-key'")))
      .rows[0].value,
    { owner: "b" },
  );
});

test("entries are isolated for read, update, delete and restore", async () => {
  const entry = { ...blankEntry("job"), id: `${prefix}-entry`, title: "Tenant A", revision: 0 };
  const saved = (await as(accountA, () => entries.saveEntry(entry))).entry;
  assert.equal(await as(accountB, () => entries.getEntry(entry.id)), null);
  await assert.rejects(
    as(accountB, () => entries.patchEntry(entry.id, saved.revision, { title: "stolen" })),
    /不存在/,
  );
  await as(accountA, () => entries.deleteEntry(entry.id, saved.revision));
  assert.equal((await as(accountA, () => entries.listDeleted())).length, 1);
  await assert.rejects(
    as(accountB, () => entries.undeleteEntry(entry.id)),
    /没有/,
  );
  await as(accountA, () => entries.undeleteEntry(entry.id));
  assert.equal((await as(accountA, () => entries.getEntry(entry.id)))?.title, "Tenant A");
});

test("composite tenant foreign key rejects a cross-owner child", async () => {
  await assert.rejects(
    as(accountB, () =>
      pool.query("INSERT INTO versions(id,entry_id,data,created) VALUES($1,$2,'{}',now())", [
        randomUUID(),
        `${prefix}-entry`,
      ]),
    ),
    (error: unknown) =>
      typeof error === "object" && error !== null && "code" in error && error.code === "23503",
  );
});

test("unscoped business pool fails and a rolled-back connection is safely reused", async () => {
  await assert.rejects(pool.query("SELECT * FROM meta"));
  await assert.rejects(
    as(accountA, () =>
      tx(async (client) => {
        await client.query("INSERT INTO meta(key,value) VALUES('rolled-back','bad')");
        throw Error("force rollback");
      }),
    ),
    /force rollback/,
  );
  assert.equal(
    (
      await as(accountB, () =>
        pool.query("SELECT count(*)::int AS n FROM meta WHERE key='rolled-back'"),
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await as(accountA, () =>
        pool.query("SELECT count(*)::int AS n FROM meta WHERE key='rolled-back'"),
      )
    ).rows[0].n,
    0,
  );
});

test("session revocation is scoped to one user", async () => {
  const [a1, a2, b1] = await Promise.all([
    accounts.createDbSession(accountA),
    accounts.createDbSession(accountA),
    accounts.createDbSession(accountB),
  ]);
  await accounts.revokeSession(a1);
  await accounts.revokeAllSessions(accountA);
  const rows = await controlPool.query(
    "SELECT account_id,revoked_at IS NOT NULL AS revoked FROM auth_sessions WHERE account_id=ANY($1::uuid[])",
    [[accountA, accountB]],
  );
  assert(rows.rows.filter((row) => row.account_id === accountA).every((row) => row.revoked));
  assert.equal(rows.rows.find((row) => row.account_id === accountB)?.revoked, false);
  assert(a2 && b1);
});

test("checkpoint tables reject cross-account writes and unfiltered reads cannot leak", async () => {
  const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
  const saver = new PostgresSaver(pool, undefined, { schema: "runway_agent" });
  await as(accountA, () => saver.setup());
  const thread = `${accountA}:shared-run`;
  await as(accountA, () =>
    pool.query(
      "INSERT INTO runway_agent.checkpoints(thread_id,checkpoint_id,checkpoint) VALUES($1,'1','{}')",
      [thread],
    ),
  );
  await as(accountA, () =>
    pool.query(
      "INSERT INTO runway_agent.checkpoint_blobs(thread_id,channel,version,type,blob) VALUES($1,'state','1','json',$2)",
      [thread, Buffer.from("private A")],
    ),
  );
  await as(accountA, () =>
    pool.query(
      "INSERT INTO runway_agent.checkpoint_writes(thread_id,checkpoint_id,task_id,idx,channel,type,blob) VALUES($1,'1','task',0,'state','json',$2)",
      [thread, Buffer.from("private A")],
    ),
  );
  for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) {
    assert.equal(
      (await as(accountB, () => pool.query(`SELECT * FROM runway_agent.${table}`))).rowCount,
      0,
    );
    assert.equal(
      (await as(accountA, () => pool.query(`SELECT * FROM runway_agent.${table}`))).rowCount,
      1,
    );
  }
  await assert.rejects(
    as(accountB, () =>
      pool.query(
        "INSERT INTO runway_agent.checkpoints(thread_id,checkpoint_id,checkpoint) VALUES($1,'2','{}')",
        [thread],
      ),
    ),
    /row-level security/,
  );
});

test("integration token index follows revocation", async () => {
  const created = await as(accountA, () => integrations.createIntegration(`${prefix}-integration`));
  const request = new Request("https://example.invalid", {
    headers: { authorization: `Bearer ${created.token}` },
  });
  assert.equal(
    (await as(accountA, () => integrations.authenticateIntegration(request))).id,
    created.id,
  );
  await as(accountA, () =>
    pool.query("UPDATE integration_clients SET revoked_at=now() WHERE id=$1", [created.id]),
  );
  await assert.rejects(
    as(accountA, () => integrations.authenticateIntegration(request)),
    /撤销|无效/,
  );
  const tokenHash = (
    await controlPool.query("SELECT revoked_at FROM integration_tokens WHERE client_id=$1", [
      created.id,
    ])
  ).rows[0];
  assert(tokenHash.revoked_at);
});

test("assessment plan settings persist per account and inherit the three-day default", async () => {
  const original = await as(accountA, getReminderPreferences);
  assert.equal(original.assessment.planDays, 3);
  await as(accountA, () =>
    saveReminderPreferences({ ...original, assessment: { ...original.assessment, planDays: 5 } }),
  );
  assert.equal((await as(accountA, getReminderPreferences)).assessment.planDays, 5);
  assert.equal((await as(accountB, getReminderPreferences)).assessment.planDays, 3);
  assert.equal((await as(accountA, getReminderPreferences)).assessment.days, 7);
  await assert.rejects(
    as(accountA, () =>
      saveReminderPreferences({ ...original, assessment: { ...original.assessment, planDays: 0 } }),
    ),
  );
  assert.equal((await as(accountA, getReminderPreferences)).assessment.planDays, 5);
});

test("recruiting dispatch deduplicates concurrent runs and withdraws stale notices", async () => {
  const entry = {
    ...blankEntry("job"),
    id: `${prefix}-recruit`,
    title: "Follow up",
    status: "已投递",
    applied: "2020-01-01",
    revision: 0,
  };
  const saved = (await as(accountA, () => entries.saveEntry(entry))).entry;
  const results = await Promise.all([
    dispatchRecruitingRemindersForUser(accountA, "2026-10-02"),
    dispatchRecruitingRemindersForUser(accountA, "2026-10-02"),
  ]);
  assert.equal(
    results.reduce((sum, item) => sum + item.created, 0),
    1,
  );
  await as(accountA, () =>
    entries.patchEntry(entry.id, saved.revision, { followUp: "2026-10-03" }),
  );
  await dispatchRecruitingRemindersForUser(accountA, "2026-10-02");
  const notice = await as(accountA, () =>
    pool.query("SELECT dismissed_at,read_at FROM notifications WHERE recruiting_key=$1", [
      `application:${entry.id}`,
    ]),
  );
  assert(notice.rows[0].dismissed_at && notice.rows[0].read_at);
});

test("AI enablement and personal settings are enforced per user", async () => {
  const config = {
    base: "https://ai.example/v1",
    key: randomBytes(24).toString("hex"),
    model: "fixture",
    tavilyKey: "",
    revision: 0,
    source: "settings" as const,
    mode: "personal" as const,
    enabled: true,
  };
  await as(accountA, () => ai.saveAiConfig(config, 0));
  assert.equal((await as(accountA, () => ai.getAiConfig())).model, "fixture");
  assert.equal((await as(accountB, () => ai.getAiConfig())).source, "none");
  await controlPool.query("UPDATE accounts SET ai_enabled=false WHERE id=$1", [accountB]);
  const disabled = await as(accountB, () => ai.getAiConfig());
  assert.equal(disabled.enabled, false);
  await assert.rejects(
    as(accountB, () => ai.saveAiConfig({ ...config, enabled: false }, 0)),
    /不允许/,
  );
});

test("same company name and directory revision remain independent across accounts", async () => {
  const { getDirectory, saveDirectory } = await import("../lib/directory-storage");
  await Promise.all(
    [accountA, accountB].map((user) =>
      as(user, async () => {
        const directory = await getDirectory();
        await saveDirectory({
          ...directory,
          companies: [
            {
              name: "Same Company",
              website: user === accountA ? "https://a.example" : "https://b.example",
              logoUrl: "",
            },
          ],
        });
      }),
    ),
  );
  assert.equal((await as(accountA, getDirectory)).companies[0].website, "https://a.example");
  assert.equal((await as(accountB, getDirectory)).companies[0].website, "https://b.example");
});

test("worker queue reads and bulk recovery updates cannot touch another user's jobs", async () => {
  const runA = randomUUID(),
    runB = randomUUID(),
    jobA = randomUUID(),
    jobB = randomUUID();
  await Promise.all(
    [
      [accountA, runA, jobA],
      [accountB, runB, jobB],
    ].map(([user, run, job]) =>
      as(user, async () => {
        await pool.query("INSERT INTO agent_runs(id,owner_id,input) VALUES($1,$2,'{}')", [
          run,
          user,
        ]);
        await pool.query(
          "INSERT INTO agent_jobs(id,run_id,kind,payload,status) VALUES($1,$2,'brief','{}','running')",
          [job, run],
        );
      }),
    ),
  );
  await as(accountA, () =>
    pool.query("UPDATE agent_jobs SET status='interrupted' WHERE status='running'"),
  );
  assert.deepEqual(
    (await as(accountA, () => pool.query("SELECT id,status FROM agent_jobs"))).rows,
    [{ id: jobA, status: "interrupted" }],
  );
  assert.deepEqual(
    (await as(accountB, () => pool.query("SELECT id,status FROM agent_jobs"))).rows,
    [{ id: jobB, status: "running" }],
  );
  await assert.rejects(
    as(accountB, () =>
      pool.query("INSERT INTO agent_jobs(id,run_id,kind,payload) VALUES($1,$2,'brief','{}')", [
        randomUUID(),
        runA,
      ]),
    ),
    /foreign key/,
  );
  assert.equal(
    (
      await as(accountB, () =>
        pool.query("UPDATE agent_jobs SET status='completed' WHERE id=$1", [jobA]),
      )
    ).rowCount,
    0,
  );
});
