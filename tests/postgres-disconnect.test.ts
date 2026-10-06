import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";

// These tests terminate only their own connections in the disposable test database.
if (!/^\/runway_backup_test_[a-z0-9_]+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw Error("Use the disposable database runner");

const run = promisify(execFile);
for (const mode of ["control", "business", "idle", "transaction", "query"]) {
  test(`PostgreSQL disconnect: ${mode} survives and reconnects`, async () => {
    // A separate process is essential: a test-runner error handler could mask the crash.
    const { stdout, stderr } = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
          import assert from 'node:assert/strict';
          import pg from 'pg';
          import { controlPool, pool, runAsUser, tx } from './lib/postgres.ts';
          const mode = ${JSON.stringify(mode)};
          const owner = '11111111-1111-4111-8111-111111111111';
          const killer = new pg.Client({ connectionString: process.env.DATABASE_URL });
          await killer.connect();
          let pid;
          async function disconnect(client) {
            pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
            // Do not subscribe to 'error' in this test: production must handle it.
            const ended = new Promise(resolve => client.once('end', resolve));
            if (mode === 'idle') client.release();
            let rejected;
            if (mode === 'query') {
              rejected = assert.rejects(client.query('SELECT pg_sleep(30)'), { code: '57P01' });
            }
            const result = await killer.query('SELECT pg_terminate_backend($1) AS killed', [pid]);
            assert.equal(result.rows[0].killed, true);
            await ended;
            if (rejected) await rejected;
          }
          try {
            await runAsUser(owner, async () => {
              if (mode === 'transaction') {
                let attempts = 0;
                await assert.rejects(tx(async client => {
                  attempts++;
                  await client.query('CREATE TABLE disconnect_rollback (id integer)');
                  await disconnect(client);
                  // COMMIT must reject; a broken transaction must not be reported as saved.
                }, { serializable: true }));
                assert.equal(attempts, 1, 'connection failure must not replay the transaction');
                assert.equal((await controlPool.query("SELECT to_regclass('disconnect_rollback') AS name")).rows[0].name, null);
              } else {
                const client = await (mode === 'business' ? pool : controlPool).connect();
                try {
                  await disconnect(client);
                  await assert.rejects(client.query('SELECT 1'));
                } finally {
                  if (mode !== 'idle') client.release();
                }
              }
              const fresh = await pool.query("SELECT pg_backend_pid() AS pid, current_setting('runway.user_id') AS owner, 42 AS value");
              assert.notEqual(fresh.rows[0].pid, pid, 'dead connection must not be reused');
              assert.equal(fresh.rows[0].owner, owner);
              assert.equal(fresh.rows[0].value, 42);
            });
            assert.equal((await controlPool.query('SELECT 7 AS value')).rows[0].value, 7);
            console.log('recovered');
          } finally {
            await killer.end();
            await controlPool.end();
          }
        `,
      ],
      { cwd: new URL("../", import.meta.url), timeout: 15000 },
    );
    assert.match(stdout, /recovered/);
    assert.doesNotMatch(stderr, /Unhandled 'error'|MaxListenersExceededWarning/);
  });
}
