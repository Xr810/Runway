-- PostgresSaver 1.0.5 data tables. Its setup still manages checkpoint_migrations;
-- create the data boundary before any request can write checkpoint contents.
CREATE SCHEMA IF NOT EXISTS runway_agent;
CREATE TABLE IF NOT EXISTS runway_agent.checkpoints (
  thread_id text NOT NULL, checkpoint_ns text NOT NULL DEFAULT '', checkpoint_id text NOT NULL,
  parent_checkpoint_id text, type text, checkpoint jsonb NOT NULL, metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS runway_agent.checkpoint_blobs (
  thread_id text NOT NULL, checkpoint_ns text NOT NULL DEFAULT '', channel text NOT NULL,
  version text NOT NULL, type text NOT NULL, blob bytea,
  PRIMARY KEY(thread_id, checkpoint_ns, channel, version)
);
CREATE TABLE IF NOT EXISTS runway_agent.checkpoint_writes (
  thread_id text NOT NULL, checkpoint_ns text NOT NULL DEFAULT '', checkpoint_id text NOT NULL,
  task_id text NOT NULL, idx integer NOT NULL, channel text NOT NULL, type text, blob bytea NOT NULL,
  PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['checkpoints','checkpoint_blobs','checkpoint_writes'] LOOP
    EXECUTE format('ALTER TABLE runway_agent.%I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE runway_agent.%I FORCE ROW LEVEL SECURITY', target);
    EXECUTE format('CREATE POLICY account_isolation ON runway_agent.%I
      USING (split_part(thread_id, '':'', 1) = nullif(current_setting(''runway.user_id'', true), ''''))
      WITH CHECK (split_part(thread_id, '':'', 1) = nullif(current_setting(''runway.user_id'', true), ''''))', target);
  END LOOP;
END $$;
