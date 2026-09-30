-- Side tasks, ongoing work and platform income are separate from job applications.
CREATE TABLE IF NOT EXISTS part_time_records (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created timestamptz NOT NULL DEFAULT now(),
  updated timestamptz NOT NULL DEFAULT now()
);
