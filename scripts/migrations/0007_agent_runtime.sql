CREATE TABLE agent_runs (
 id uuid PRIMARY KEY, owner_id text NOT NULL, version int NOT NULL DEFAULT 1,
 input jsonb NOT NULL, status text NOT NULL DEFAULT 'planning',
 error text NOT NULL DEFAULT '', created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_runs_owner_updated ON agent_runs(owner_id, updated DESC);
CREATE TABLE agent_operations (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 decision text NOT NULL CHECK(decision IN ('approved','rejected')), result jsonb NOT NULL,
 created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_jobs (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 kind text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending',
 result jsonb, error text NOT NULL DEFAULT '', created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_jobs_pending ON agent_jobs(created) WHERE status='pending';
