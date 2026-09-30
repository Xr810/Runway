-- Documents become jsonb and timestamps timestamptz, so queries no longer cast every row.
ALTER TABLE entries ALTER COLUMN data TYPE jsonb USING data::jsonb, ALTER COLUMN updated TYPE timestamptz USING updated::timestamptz;
ALTER TABLE entries ADD COLUMN deleted_at timestamptz;
ALTER TABLE entries ADD COLUMN kind text GENERATED ALWAYS AS (data->>'kind') STORED;
CREATE INDEX entries_live_idx ON entries(kind, updated DESC) WHERE deleted_at IS NULL;
ALTER TABLE versions ALTER COLUMN data TYPE jsonb USING data::jsonb, ALTER COLUMN created TYPE timestamptz USING created::timestamptz;
ALTER TABLE files ALTER COLUMN created TYPE timestamptz USING created::timestamptz;
ALTER TABLE company_watches ALTER COLUMN data TYPE jsonb USING data::jsonb, ALTER COLUMN updated TYPE timestamptz USING updated::timestamptz;
ALTER TABLE integration_events ALTER COLUMN result TYPE jsonb USING result::jsonb, ALTER COLUMN notification TYPE jsonb USING notification::jsonb;
-- Scores trigger reads jsonb directly now.
CREATE OR REPLACE FUNCTION protect_manual_scores() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('opportunity.enrichment_write',true) IS DISTINCT FROM 'on'
     AND NEW.data->>'kind'='job'
     AND (TG_OP='INSERT' OR (NEW.data->'fit',NEW.data->'career',NEW.data->'outlook') IS DISTINCT FROM (OLD.data->'fit',OLD.data->'career',OLD.data->'outlook'))
     AND (TG_OP='UPDATE' OR coalesce(NEW.data->>'fit',NEW.data->>'career',NEW.data->>'outlook') IS NOT NULL)
  THEN INSERT INTO enrichment_state(kind,target_id,locked) VALUES('job',NEW.id,true) ON CONFLICT(kind,target_id) DO UPDATE SET locked=true; END IF;
  RETURN NEW;
END $$;
