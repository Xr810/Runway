# Security

Runway is a self-hosted multi-account application with per-account data isolation. It does not
provide team sharing. Protect it with HTTPS, strong account passwords, isolated database
credentials, and preferably an identity-aware proxy. The application PostgreSQL role must be a
non-superuser without `BYPASSRLS`; row-level security is part of the isolation boundary.

Never commit populated environment files, database exports, CVs, attachments, session
cookies, AI/search keys, integration tokens, or infrastructure credentials. Use independent
session-signing and AI-key encryption secrets. Backups contain private data and require
restricted access. AI/search features transmit relevant content to configured providers.
In personal AI mode, each account supplies its own provider credentials; in managed mode, only
deployment credentials are used. In both modes, the account's `ai_enabled` permission is
authoritative.

Password accounts currently have no email verification or password-recovery flow. Google login
requires Google's verified-email claim, but Runway never links Google and password identities
automatically merely because their email addresses match.

For record maintenance, administrators and Agents must use the account-scoped application
writers/API with schema validation and revision checks, not direct SQL updates. After a write,
read the record and the list again to verify it. Interactive lists report invalid record IDs
and field paths without deleting or rewriting those records; counts exclude failed records.
Exports and automation fail closed on invalid records rather than using incomplete snapshots.
Keep diagnostic reports to IDs and field paths, never full record content. Reproduce and repair
invalid data in a disposable environment before any explicitly authorized production repair.

Assessment login/password fields are stored separately from records using AES-256-GCM and
`AI_SETTINGS_KEY`, bound to the owner, record, and assessment. They are not part of Agent
snapshots, history, ordinary ZIP/JSON exports, or restores. Re-enter them after moving via an
ordinary backup. A protected infrastructure database backup retains the encrypted values;
recovering them also requires the original encryption key, stored separately and securely.
Losing or replacing that key makes the existing credentials unreadable. Do not put credentials
in JD text, notes, URLs, or other unencrypted fields to bypass this boundary.

For vulnerabilities, use GitHub private vulnerability reporting when available. Do not
include credentials or personal data in public issues. Rotate exposed credentials;
deleting a file in the latest commit does not erase it from Git history.
