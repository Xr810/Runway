ALTER TABLE notifications ADD COLUMN recruiting_key text, ADD COLUMN recruiting_due_date date;
CREATE UNIQUE INDEX notifications_recruiting_once ON notifications(user_id,recruiting_key,recruiting_due_date) WHERE recruiting_key IS NOT NULL;
CREATE INDEX notifications_recruiting_open ON notifications(user_id,recruiting_key) WHERE recruiting_key IS NOT NULL AND dismissed_at IS NULL;
