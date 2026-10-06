# Runway

**Manage job applications, projects, competitions, and part-time income in one place, with an AI assistant that asks for confirmation before applying changes.**

Runway is a self-hosted web application with a primarily Chinese interface. Track opportunities, recruiting stages, interviews, and reminders; ask the assistant to extract information from job links, text, or screenshots, assess opportunities, and fill in company details. Each account has an isolated personal workspace. **There are no shared records or team workspaces.**

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · LangGraph

[Quick start](#quick-start) · [Deployment](deploy/README.md) · [AI development and handoff](AGENTS.md) · [Security](SECURITY.md)

## Features

| Module                    | Purpose                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Today and schedule        | Review tasks, reminders, recruiting milestones, and interviews                                         |
| Jobs                      | Track applications, recruiting stages, job descriptions, attachments, and assessments                  |
| Projects and competitions | Track other opportunities, progress, and deadlines                                                     |
| Part-time work and income | Record part-time work and earnings                                                                     |
| Companies and watches     | Manage company information and recruiting sources; scan at configured times when automation is enabled |
| Insights                  | Summarize records and assessments to help prioritize opportunities                                     |
| AI assistant              | Read context, organize information, propose changes, and execute or queue work after confirmation      |
| Settings and data         | Manage personal background, CV, AI settings, integrations, recycle bin, and backup/restore             |

AI is optional: manual record management does not require it. Link extraction depends on the source website, and generated assessments and company details need human review. Background automation requires model configuration, the relevant features enabled, and a running scheduler. Not every recruiting website can be scraped.

For assessments without a company deadline, Runway derives a plan from the notification date plus **3 calendar days** by default. Change this account-specific default (1–90 days) in **Settings → 招聘提醒 → 测评默认计划天数**. Changing it recalculates plans without writing company deadlines. A missing notification date stays unknown. This is separate from the default seven-day post-completion follow-up; selecting a company-deadline-based follow-up still requires a real company deadline.

## Quick start

Requirements: **Node.js ≥ 22.13, npm, and PostgreSQL 17**.

### 1. Install and configure

```sh
git clone https://github.com/Xr810/Runway.git
cd Runway
npm ci
cp .env.example .env.local
```

Create a dedicated, empty database and set `DATABASE_URL` in `.env.local`. Its role should own the application schema but **must not be a superuser or have `BYPASSRLS`**, which would bypass row-level security. The multi-account migration may refuse databases containing legacy business records; do not apply these instructions directly to production data.

Run the following command twice to generate independent values for `SESSION_SECRET` and `AI_SETTINGS_KEY`. Store them only in your local configuration:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Key settings are listed below. See [`.env.example`](.env.example) for the full configuration.

| Variable          | Purpose                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string                                                                      |
| `APP_ORIGIN`      | Actual application origin, including protocol and port where needed                               |
| `SESSION_SECRET`  | Independent random session secret, at least 32 characters                                         |
| `AI_SETTINGS_KEY` | Independent random AI-settings encryption key, at least 32 characters; retain it securely         |
| `ATTACHMENTS_DIR` | Attachment storage; the development example uses `./data/attachments`                             |
| `SCHEDULER`       | Keep `off` during development; disables both scheduled automation and the agent background worker |
| `AI_MODE`         | Defaults to `personal`; `managed` uses deployment-owned configuration                             |

### 2. Migrate and start

After confirming that the connection points to your development database:

```sh
node --env-file=.env.local scripts/migrate.mjs
npm run dev
```

Open the address printed by the development server in your local browser, then register with an email address and a password of at least 10 characters. **`npm run dev` and `npm start` do not run migrations automatically; Docker container startup does.**

For development in an Amp orb, the repository provides [`.agents/setup`](.agents/setup) and a [service configuration](.amp/services.yaml). Once the environment is ready, run `amp orb services ensure` and use the returned Portal link. This setup is intended for disposable development data, not production.

### 3. Enable optional AI and sign-in providers

- **Personal mode (`personal`):** configure a compatible model endpoint, model name, and API key in Settings, with an optional Tavily search key. Deployment AI credentials are never used as a fallback.
- **Managed mode (`managed`):** uses only the deployment's `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and `TAVILY_API_KEY`. Users cannot view, edit, or test those credentials.
- Both modes respect the account's server-side `ai_enabled` permission. AI and search features send relevant content to the configured providers; review their privacy policies first.
- Google sign-in is optional. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and authorize `${APP_ORIGIN}/api/auth/google/callback` as the redirect URI.

**Email verification and password recovery are not implemented.** Google identities and password accounts with matching email addresses are not linked automatically. Product dates and schedules use the fixed `Asia/Hong_Kong` timezone (UTC+8), not the browser's local timezone.

## Deployment and data safety

Build with the root `Dockerfile`; see the [deployment guide](deploy/README.md) for instructions and upgrade constraints. Production requires HTTPS, a dedicated database, persistent attachment storage, and coordinated backups of the database and files.

- Container startup applies all pending migrations. Back up and test restoration before upgrading; starting a container is not a database-side-effect-free operation.
- Full exports include the recycle bin, attachments, and CV. Restore validates files and performs database writes in a single transaction, preserves existing records and settings, and supports retry after failure.
- The database and filesystem do not share an atomic transaction. A failed restore may leave file remnants that cannot be accessed through the application; zero residue is not guaranteed.
- Never commit environment secrets, CVs, attachments, or database exports. See [SECURITY.md](SECURITY.md) for security boundaries and vulnerability reporting.

## Code navigation

| Path                  | Responsibility                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `app/(app)/`          | Authenticated pages and layouts                                                                     |
| `app/api/`            | HTTP routes; `integrations/v1` is the Muse integration API                                          |
| `components/app/`     | Business UI, record store, separate contexts, and assistant conversation lifecycle                  |
| `components/ui/`      | shadcn/ui primitives                                                                                |
| `lib/`                | Domain logic for records, attachments, backups, scanning, AI workflows, permissions, and scheduling |
| `scripts/migrations/` | Numbered database migrations                                                                        |
| `tests/`              | Unit, database, and API tests, plus a deterministic mock model                                      |
| `deploy/`             | Deployment documentation                                                                            |

Business requests pass through API routes and domain modules to account-isolated PostgreSQL and file storage. The AI assistant reuses those modules through a **plan → propose → confirm → execute** flow. LangGraph manages durable workflows and recovery; it does not replace business interfaces or authorization. See [AGENTS.md](AGENTS.md) for maintenance constraints.

## Development and verification

```sh
npm test                 # tests/unit/*.test.ts only; excludes database/API integration tests
npm run lint
npx tsc --noEmit
npm run build
npm run format:check -- README.md AGENTS.md
```

Format only changed files with `npm run format -- <paths>`. Database tests (`npm run test:db`) and API tests (`npm run test:api`) **must use disposable test databases and attachment directories**: they create, modify, and delete data. See [AGENTS.md](AGENTS.md#verification) for environment loading, mock-model setup, and other integration-test precautions.

For a repeatable local database regression run, use `npm run test:db:isolated`. It creates a unique database and temporary attachment directory, migrates that database, runs tenant-isolation, backup, agent transaction/retry, and summary-read tests, then removes its own resources. It never uses `DATABASE_URL`. The default connection is the local PostgreSQL Unix socket and current OS role; `TEST_DATABASE_ADMIN_URL` may select another **local** test server. The role needs `CREATEDB` and must have neither `SUPERUSER` nor `BYPASSRLS`. Do not grant these privileges to the production application role. This command does not start an app server or run API tests.

`tests/entry-read.test.ts` reports a synthetic baseline rather than asserting machine-specific timing: 100 records with 50,000 UTF-16 units of JD each. An orb run read summaries in a median 60 ms over five reads; serialized full records were 12.07 MB versus 75 KB of summaries. This is not production latency or measured network traffic. The current implementation still reads full records from PostgreSQL before omitting JD. A SQL projection is deferred: it must preserve complete-JD validation, legacy normalization, and JavaScript UTF-16 counts (SQL character counts differ for emoji). The planner also retains request-scoped full snapshots because proposals need preserved fields and revision checks; this baseline does not measure or justify rewriting that workflow. Re-run the baseline when evaluating a separate projection or lazy-loading change.

## Current version and limitations

The current version is **0.1.0**. The “Runway 0.1.0” entry in Settings displays release notes; the version comes from `package.json`. This version adds company country/region and introduction fields, strengthens concurrent attachment publication and backup recovery, and stops generating or displaying new job-description history and saved timestamps while retaining compatibility with old history.

The release note describes this as the “first official release.” **That label is not evidence that a particular deployment has passed production acceptance checks.** Team workspaces, an admin panel, subscriptions/billing, and Gmail/MCP connections are not implemented.

This public repository excludes the original import history, user records, CVs, attachments, environment files, and private infrastructure scripts. Before continuing development, read [AGENTS.md](AGENTS.md) and the relevant Git history for design rationale and unfinished work.
