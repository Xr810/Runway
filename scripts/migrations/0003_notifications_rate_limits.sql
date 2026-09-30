-- Notifications get their own table; integration_events keeps only the idempotency log.
CREATE TABLE notifications (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, actor text NOT NULL, action text NOT NULL,
  entry_id text, title text NOT NULL DEFAULT '', organization text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '',
  source jsonb NOT NULL DEFAULT '{}', changes jsonb NOT NULL DEFAULT '[]',
  created timestamptz NOT NULL DEFAULT now(), read_at timestamptz, dismissed_at timestamptz);
CREATE INDEX notifications_open_idx ON notifications(seq DESC) WHERE dismissed_at IS NULL;
INSERT INTO notifications(id,actor,action,entry_id,title,organization,summary,source,changes,created,read_at,dismissed_at)
  SELECT id, coalesce(notification->>'actor',''), coalesce(notification->>'action',''), notification->>'entryId',
    coalesce(notification->>'title',''), coalesce(notification->>'organization',''), coalesce(notification->>'summary',''),
    coalesce(notification->'source','{}'), coalesce(notification->'changes','[]'), created, read_at, dismissed_at
  FROM integration_events ORDER BY seq;
-- Columns the "newer source" check needs, so it no longer scans jsonb.
ALTER TABLE integration_events ADD COLUMN entry_id text, ADD COLUMN action text, ADD COLUMN source_kind text, ADD COLUMN occurred_at timestamptz;
UPDATE integration_events SET entry_id=notification->>'entryId', action=notification->>'action', source_kind=notification->'source'->>'kind', occurred_at=(notification->'source'->>'occurredAt')::timestamptz;
DELETE FROM integration_events WHERE request_id LIKE 'enrichment:%';
DROP INDEX IF EXISTS integration_notifications_idx;
ALTER TABLE integration_events DROP COLUMN notification, DROP COLUMN read_at, DROP COLUMN dismissed_at;
CREATE INDEX integration_events_source_idx ON integration_events(entry_id, action, source_kind, occurred_at);
-- Rate limiting by key (per IP, per feature). Replaces the single login_attempts row.
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, window_start timestamptz NOT NULL);
DROP TABLE login_attempts;
