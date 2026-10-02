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

For vulnerabilities, use GitHub private vulnerability reporting when available. Do not
include credentials or personal data in public issues. Rotate exposed credentials;
deleting a file in the latest commit does not erase it from Git history.
