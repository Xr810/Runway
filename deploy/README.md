# Docker deployment

Build the root Dockerfile with `docker build -t runway:local .`. The container runs
numbered database migrations before starting the standalone Next.js server.

Supply the configuration described in `.env.example` through a secret manager or a
private environment file. Use an HTTPS `APP_ORIGIN`, `ATTACHMENTS_DIR=/data/attachments`,
and independent random session/encryption secrets. Connect to a fresh, dedicated PostgreSQL 17
database using a role that owns the Runway schema but is neither a superuser nor granted
`BYPASSRLS`. Those privileges bypass the row-level-security isolation boundary.

The multi-account migration deliberately refuses a database containing legacy business records;
it never deletes or assigns those records automatically. Deploy this version against a fresh
database. Preserve and handle any old database separately according to your own retention or
manual migration plan. Never run migrations against production without explicit operator
authorization, a tested backup, and a rollback plan; container startup runs all pending numbered
migrations automatically.

The container listens on port 3000 and runs as UID/GID 1000. Mount persistent attachment
storage at `/data/attachments` with write permission for that user. Persist PostgreSQL
separately. Back up both before upgrades and test restoration in isolation.

Put an HTTPS reverse proxy in front of Runway; production cookies are Secure. Restrict
direct access to the application and database. The application trusts proxy IP headers
for rate limiting, so the proxy must replace client-supplied IP headers. An additional
identity-aware access layer is recommended.

Accounts have isolated personal records; there are no teams or shared workspaces. Password signup
does not verify email and there is no password recovery. Google OAuth is optional: set its client
credentials and authorize `${APP_ORIGIN}/api/auth/google/callback`. A matching email does not
automatically link a Google identity to a password account.

Set `AI_MODE=personal` (the default) for user-owned provider configuration, or `managed` to use
only deployment AI/search credentials and prevent users from editing or testing them. The
per-account `ai_enabled` database permission overrides either mode. Keep `SCHEDULER=off` until
automated scanning is configured and reviewed. AI/search providers receive content relevant to
requested features; review their data policies before uploading personal information. Product
dates and schedules use the fixed `Asia/Hong_Kong` timezone.

Verify `/api/health`, sign-in, storage, and core flows after deployment. Retain previous
images and matching backups. Original production scripts, access-policy identifiers,
and one-off import utilities are intentionally not published.
