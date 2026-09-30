-- Schema as deployed on 2026-09-27. Idempotent, so existing databases adopt it unchanged.
CREATE TABLE IF NOT EXISTS entries (id text PRIMARY KEY, data text NOT NULL, revision integer NOT NULL DEFAULT 1, updated text NOT NULL);
CREATE TABLE IF NOT EXISTS versions (id text PRIMARY KEY, entry_id text NOT NULL REFERENCES entries(id), data text NOT NULL, created text NOT NULL);
CREATE INDEX IF NOT EXISTS versions_entry_idx ON versions(entry_id);
CREATE TABLE IF NOT EXISTS files (id text PRIMARY KEY, entry_id text NOT NULL REFERENCES entries(id), name text NOT NULL, type text NOT NULL, size integer NOT NULL, created text NOT NULL);
CREATE INDEX IF NOT EXISTS files_entry_idx ON files(entry_id);
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS company_watches (id text PRIMARY KEY, data text NOT NULL, revision integer NOT NULL DEFAULT 1, updated text NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (id text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS integration_clients (id text PRIMARY KEY, name text NOT NULL, token_hash text NOT NULL UNIQUE, token_hint text NOT NULL, created timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, last_used_at timestamptz);
CREATE TABLE IF NOT EXISTS integration_events (seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, client_id text NOT NULL REFERENCES integration_clients(id), request_id text NOT NULL, request_hash text NOT NULL, result text NOT NULL, notification text NOT NULL, created timestamptz NOT NULL DEFAULT now(), read_at timestamptz, dismissed_at timestamptz, UNIQUE(client_id,request_id));
CREATE TABLE IF NOT EXISTS integration_job_refs (client_id text NOT NULL REFERENCES integration_clients(id), external_id text NOT NULL, entry_id text NOT NULL REFERENCES entries(id), PRIMARY KEY(client_id,external_id));
CREATE INDEX IF NOT EXISTS integration_notifications_idx ON integration_events(seq DESC) WHERE dismissed_at IS NULL;
CREATE TABLE IF NOT EXISTS enrichment_tasks (id text PRIMARY KEY, kind text NOT NULL, target_id text NOT NULL, input_hash text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending', actor_id text, lease_token text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '', result_hash text, created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS enrichment_task_target ON enrichment_tasks(kind,target_id,created DESC);
CREATE UNIQUE INDEX IF NOT EXISTS enrichment_one_active ON enrichment_tasks(kind,target_id) WHERE status IN ('pending','running');
CREATE TABLE IF NOT EXISTS enrichment_results (id text PRIMARY KEY, task_id text NOT NULL UNIQUE REFERENCES enrichment_tasks(id), kind text NOT NULL, target_id text NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL, actor text NOT NULL, created timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS enrichment_result_target ON enrichment_results(kind,target_id,created DESC);
CREATE TABLE IF NOT EXISTS enrichment_state (kind text NOT NULL, target_id text NOT NULL, locked boolean NOT NULL DEFAULT false, result_id text REFERENCES enrichment_results(id), PRIMARY KEY(kind,target_id));
CREATE TABLE IF NOT EXISTS brand_assets (id text PRIMARY KEY, mime text NOT NULL, bytes bytea NOT NULL, created timestamptz NOT NULL DEFAULT now());
-- Manual score edits lock the job so automated assessments never overwrite them.
CREATE OR REPLACE FUNCTION protect_manual_scores() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('opportunity.enrichment_write',true) IS DISTINCT FROM 'on'
     AND NEW.data::jsonb->>'kind'='job'
     AND (TG_OP='INSERT' OR (NEW.data::jsonb->'fit',NEW.data::jsonb->'career',NEW.data::jsonb->'outlook') IS DISTINCT FROM (OLD.data::jsonb->'fit',OLD.data::jsonb->'career',OLD.data::jsonb->'outlook'))
     AND (TG_OP='UPDATE' OR coalesce(NEW.data::jsonb->>'fit',NEW.data::jsonb->>'career',NEW.data::jsonb->>'outlook') IS NOT NULL)
  THEN INSERT INTO enrichment_state(kind,target_id,locked) VALUES('job',NEW.id,true) ON CONFLICT(kind,target_id) DO UPDATE SET locked=true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS entries_manual_scores ON entries;
CREATE TRIGGER entries_manual_scores AFTER INSERT OR UPDATE ON entries FOR EACH ROW EXECUTE FUNCTION protect_manual_scores();
INSERT INTO enrichment_state(kind,target_id,locked) SELECT 'job',id,true FROM entries WHERE data::jsonb->>'kind'='job' AND coalesce(data::jsonb->>'fit',data::jsonb->>'career',data::jsonb->>'outlook') IS NOT NULL ON CONFLICT DO NOTHING;
