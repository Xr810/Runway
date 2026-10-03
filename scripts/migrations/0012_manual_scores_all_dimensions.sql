-- Manual edits to any of the five score dimensions must lock the job so automated
-- assessments cannot overwrite them (#1). Earlier triggers only watched fit/career/outlook.
CREATE OR REPLACE FUNCTION protect_manual_scores() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('opportunity.enrichment_write',true) IS DISTINCT FROM 'on'
     AND NEW.data->>'kind'='job'
     AND (TG_OP='INSERT' OR (NEW.data->'fit',NEW.data->'career',NEW.data->'returnOffer',NEW.data->'academic',NEW.data->'outlook') IS DISTINCT FROM (OLD.data->'fit',OLD.data->'career',OLD.data->'returnOffer',OLD.data->'academic',OLD.data->'outlook'))
     AND (TG_OP='UPDATE' OR coalesce(NEW.data->>'fit',NEW.data->>'career',NEW.data->>'returnOffer',NEW.data->>'academic',NEW.data->>'outlook') IS NOT NULL)
  THEN INSERT INTO enrichment_state(user_id,kind,target_id,locked) VALUES(NEW.user_id,'job',NEW.id,true) ON CONFLICT(user_id,kind,target_id) DO UPDATE SET locked=true; END IF;
  RETURN NEW;
END $$;

-- Backfill locks for records that already carry a manual score. RLS scopes entries per
-- account, so visit each user with the tenant context set.
DO $$
DECLARE uid uuid;
BEGIN
  FOR uid IN SELECT id FROM accounts LOOP
    PERFORM set_config('runway.user_id', uid::text, true);
    INSERT INTO enrichment_state(user_id,kind,target_id,locked)
      SELECT uid,'job',id,true FROM entries
      WHERE data->>'kind'='job'
        AND coalesce(data->>'fit',data->>'career',data->>'returnOffer',data->>'academic',data->>'outlook') IS NOT NULL
      ON CONFLICT(user_id,kind,target_id) DO UPDATE SET locked=true;
  END LOOP;
  PERFORM set_config('runway.user_id','',true);
END $$;
