-- The schema normalizes job records; enforce the same rule at persistence so
-- partial legacy history and backup restores cannot reintroduce retired fields.
CREATE OR REPLACE FUNCTION retire_job_misc_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'entries' THEN
    IF NEW.data->>'kind' = 'job' THEN
      NEW.data := NEW.data || '{"notes":"","extra":{}}'::jsonb;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM entries WHERE id = NEW.entry_id AND user_id = NEW.user_id AND kind = 'job') THEN
    NEW.data := NEW.data - 'notes' - 'extra';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS retire_job_misc_fields ON entries;
CREATE TRIGGER retire_job_misc_fields BEFORE INSERT OR UPDATE ON entries
  FOR EACH ROW EXECUTE FUNCTION retire_job_misc_fields();
DROP TRIGGER IF EXISTS retire_job_misc_fields ON versions;
CREATE TRIGGER retire_job_misc_fields BEFORE INSERT OR UPDATE ON versions
  FOR EACH ROW EXECUTE FUNCTION retire_job_misc_fields();

-- Include recycle-bin entries and all history, retaining tenant isolation.
-- Bump revisions only for changed records so stale pages cannot undo cleanup.
DO $$
DECLARE uid uuid;
BEGIN
  FOR uid IN SELECT id FROM accounts LOOP
    PERFORM set_config('runway.user_id', uid::text, true);
    UPDATE entries SET
      data = data || jsonb_build_object('notes', '', 'extra', '{}'::jsonb, 'revision', revision + 1),
      revision = revision + 1, updated = now()
      WHERE kind = 'job' AND
        (data->'notes' IS DISTINCT FROM '""'::jsonb OR data->'extra' IS DISTINCT FROM '{}'::jsonb);
    UPDATE versions v SET data = v.data - 'notes' - 'extra'
      FROM entries e WHERE e.id = v.entry_id AND e.user_id = v.user_id AND e.kind = 'job'
        AND (v.data ? 'notes' OR v.data ? 'extra');
  END LOOP;
  PERFORM set_config('runway.user_id', '', true);
END $$;
