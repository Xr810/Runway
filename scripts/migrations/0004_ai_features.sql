-- Reminders shown on the Today page; one row per completed occurrence.
CREATE TABLE reminders (
  id text PRIMARY KEY, title text NOT NULL, note text NOT NULL DEFAULT '', url text NOT NULL DEFAULT '',
  schedule jsonb NOT NULL, active boolean NOT NULL DEFAULT true, entry_id text REFERENCES entries(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'user', revision integer NOT NULL DEFAULT 1,
  created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now());
CREATE TABLE reminder_done (reminder_id text NOT NULL REFERENCES reminders(id) ON DELETE CASCADE, day date NOT NULL, done_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(reminder_id, day));
-- Automatic scanning of watched career pages and job boards.
CREATE TABLE crawl_runs (
  id text PRIMARY KEY, watch_id text NOT NULL, trigger text NOT NULL, status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  found integer NOT NULL DEFAULT 0, judged integer NOT NULL DEFAULT 0, added integer NOT NULL DEFAULT 0, error text NOT NULL DEFAULT '', detail jsonb NOT NULL DEFAULT '{}');
CREATE INDEX crawl_runs_watch_idx ON crawl_runs(watch_id, started_at DESC);
CREATE TABLE crawl_seen (
  watch_id text NOT NULL, key text NOT NULL, title text NOT NULL DEFAULT '', decision text NOT NULL, reason text NOT NULL DEFAULT '',
  entry_id text, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(watch_id, key));
-- Uploaded documents such as the CV; bytes live in the attachments directory.
CREATE TABLE documents (id text PRIMARY KEY, kind text NOT NULL, name text NOT NULL, mime text NOT NULL, size integer NOT NULL, text text NOT NULL DEFAULT '', created timestamptz NOT NULL DEFAULT now());
-- Cached AI output, such as the daily briefing.
CREATE TABLE ai_cache (key text PRIMARY KEY, value jsonb NOT NULL, created timestamptz NOT NULL DEFAULT now());
