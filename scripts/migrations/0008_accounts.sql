CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_credentials (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (email=lower(email)), password_hash text NOT NULL
);
CREATE TABLE account_identities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL, subject text NOT NULL, email text,
  PRIMARY KEY(provider,subject)
);
CREATE TABLE auth_sessions (
  token_hash bytea PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX auth_sessions_account_idx ON auth_sessions(account_id) WHERE revoked_at IS NULL;
CREATE TABLE oauth_attempts (
  state_hash bytea PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
