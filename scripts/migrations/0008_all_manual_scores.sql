-- Protect all five score dimensions, including clearing a manually edited score.
CREATE OR REPLACE FUNCTION protect_manual_scores() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('opportunity.enrichment_write',true) IS DISTINCT FROM 'on'
     AND NEW.data->>'kind'='job'
     AND (TG_OP='INSERT' OR (NEW.data->'fit',NEW.data->'career',NEW.data->'outlook',NEW.data->'returnOffer',NEW.data->'academic') IS DISTINCT FROM (OLD.data->'fit',OLD.data->'career',OLD.data->'outlook',OLD.data->'returnOffer',OLD.data->'academic'))
     AND (TG_OP='UPDATE' OR coalesce(NEW.data->>'fit',NEW.data->>'career',NEW.data->>'outlook',NEW.data->>'returnOffer',NEW.data->>'academic') IS NOT NULL)
  THEN INSERT INTO enrichment_state(kind,target_id,locked) VALUES('job',NEW.id,true) ON CONFLICT(kind,target_id) DO UPDATE SET locked=true; END IF;
  RETURN NEW;
END $$;
