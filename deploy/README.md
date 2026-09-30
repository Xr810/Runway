# Docker deployment

Build the root Dockerfile with `docker build -t runway:local .`. The container runs
numbered database migrations before starting the standalone Next.js server.

Supply the configuration described in `.env.example` through a secret manager or a
private environment file. Use an HTTPS `APP_ORIGIN`, `ATTACHMENTS_DIR=/data/attachments`,
independent random session/encryption secrets, and a unique login password hash.
Connect to a dedicated PostgreSQL database and role.

The container listens on port 3000 and runs as UID/GID 1000. Mount persistent attachment
storage at `/data/attachments` with write permission for that user. Persist PostgreSQL
separately. Back up both before upgrades and test restoration in isolation.

Put an HTTPS reverse proxy in front of Runway; production cookies are Secure. Restrict
direct access to the application and database. The application trusts proxy IP headers
for rate limiting, so the proxy must replace client-supplied IP headers. An additional
identity-aware access layer is recommended.

This is a single-user application: authenticated sessions access the same records.
Do not host unrelated users in one instance. Keep `SCHEDULER=off` until automated scanning
is configured and reviewed. AI/search providers receive content relevant to requested
features; review their data policies before uploading personal information.

Verify `/api/health`, sign-in, storage, and core flows after deployment. Retain previous
images and matching backups. Original production scripts, access-policy identifiers,
and one-off import utilities are intentionally not published.

Keep `OWNER_ID` stable across upgrades (default: `owner`). When migrating from a private
build, set it to that build's existing session subject/account ID before starting the new
image. This preserves signed sessions and access to existing AI run history without
rewriting user data. Keep the same `SESSION_SECRET` and session-version metadata too.
