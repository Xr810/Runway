// This release intentionally starts with empty business data. Do not silently
// assign single-owner records to a newly registered account.
const tables = ["entries", "versions", "files", "meta", "company_watches", "integration_clients", "integration_events", "integration_job_refs", "enrichment_tasks", "enrichment_results", "enrichment_state", "brand_assets", "notifications", "reminders", "reminder_done", "crawl_runs", "crawl_seen", "documents", "ai_cache", "part_time_records", "agent_runs", "agent_operations", "agent_jobs"];
export default async function migrate(client) {
  const role = (await client.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  if (role.rolsuper || role.rolbypassrls) throw Error("Runway requires a non-superuser, non-BYPASSRLS database role.");
  for (const table of tables) {
    if ((await client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount) throw Error(`Multi-user schema requires empty test data (${table}). Use a new database; this migration never deletes data.`);
    await client.query(`ALTER TABLE ${table} ADD COLUMN user_id uuid NOT NULL DEFAULT nullif(current_setting('runway.user_id',true),'')::uuid REFERENCES accounts(id);
      CREATE INDEX ${table}_user_idx ON ${table}(user_id);
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY account_isolation ON ${table} USING (user_id = nullif(current_setting('runway.user_id',true),'')::uuid) WITH CHECK (user_id = nullif(current_setting('runway.user_id',true),'')::uuid);`);
  }
  for (const [table, columns] of [["meta", "key"], ["ai_cache", "key"], ["enrichment_state", "kind,target_id"]]) {
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey, ADD PRIMARY KEY(user_id,${columns})`);
  }
  await client.query("DROP INDEX enrichment_one_active; CREATE UNIQUE INDEX enrichment_one_active ON enrichment_tasks(user_id,kind,target_id) WHERE status IN ('pending','running')");
  // Composite foreign keys stop a user attaching a private child row to somebody
  // else's parent, even when the caller knows its UUID. Retain global UUID keys.
  const foreignKeys = (await client.query(`SELECT c.conname, c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY ord) AS child_columns,
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY ord) AS parent_columns
    FROM pg_constraint c WHERE c.contype='f' AND c.conrelid::regclass::text=ANY($1) AND c.confrelid::regclass::text=ANY($1)`, [tables])).rows;
  for (const fk of foreignKeys) {
    const index = `${fk.parent}_${fk.parent_columns.join('_')}_tenant_ref`;
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${fk.parent}(user_id,${fk.parent_columns.join(',')});
      ALTER TABLE ${fk.child} ADD CONSTRAINT ${fk.conname}_tenant FOREIGN KEY(user_id,${fk.child_columns.join(',')}) REFERENCES ${fk.parent}(user_id,${fk.parent_columns.join(',')}) DEFERRABLE INITIALLY DEFERRED`);
  }
  await client.query(`ALTER TABLE accounts ADD COLUMN ai_enabled boolean NOT NULL DEFAULT true;
    ALTER TABLE agent_runs ADD CONSTRAINT agent_owner_matches CHECK(owner_id=user_id::text);
    CREATE TABLE integration_tokens(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES accounts(id), client_id text NOT NULL, revoked_at timestamptz);
    CREATE FUNCTION sync_integration_token() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN DELETE FROM integration_tokens WHERE client_id=OLD.id; RETURN OLD; END IF;
      INSERT INTO integration_tokens(token_hash,user_id,client_id,revoked_at) VALUES(NEW.token_hash,NEW.user_id,NEW.id,NEW.revoked_at)
      ON CONFLICT(token_hash) DO UPDATE SET revoked_at=EXCLUDED.revoked_at;
      RETURN NEW;
    END $$;
    CREATE TRIGGER integration_token_index AFTER INSERT OR UPDATE OR DELETE ON integration_clients FOR EACH ROW EXECUTE FUNCTION sync_integration_token();
    CREATE OR REPLACE FUNCTION protect_manual_scores() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('opportunity.enrichment_write',true) IS DISTINCT FROM 'on' AND NEW.data->>'kind'='job'
         AND (TG_OP='INSERT' OR (NEW.data->'fit',NEW.data->'career',NEW.data->'outlook') IS DISTINCT FROM (OLD.data->'fit',OLD.data->'career',OLD.data->'outlook'))
         AND (TG_OP='UPDATE' OR coalesce(NEW.data->>'fit',NEW.data->>'career',NEW.data->>'outlook') IS NOT NULL)
      THEN INSERT INTO enrichment_state(kind,target_id,locked) VALUES('job',NEW.id,true) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET locked=true; END IF;
      RETURN NEW;
    END $$;`);
}
