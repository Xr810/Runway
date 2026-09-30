# Security

Runway is a self-hosted single-user application. Protect it with HTTPS, a strong login
password, isolated database credentials, and preferably an identity-aware proxy.
It is not a multi-tenant service.

Never commit populated environment files, database exports, CVs, attachments, session
cookies, AI/search keys, integration tokens, or infrastructure credentials. Use independent
session-signing and AI-key encryption secrets. Backups contain private data and require
restricted access. AI/search features transmit relevant content to configured providers.

For vulnerabilities, use GitHub private vulnerability reporting when available. Do not
include credentials or personal data in public issues. Rotate exposed credentials;
deleting a file in the latest commit does not erase it from Git history.
