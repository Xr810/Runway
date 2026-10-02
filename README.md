# Runway

Personal tracker for job applications, side projects and competitions, with an assistant that
works on the data: it reads job links and screenshots, sets reminders, adjusts the target fields,
scans watched career pages every morning and fills in missing company details.

Next.js 16 (App Router) · React 19 · PostgreSQL 17 · Docker · LangGraph.
The interface is primarily Chinese. Each account has an isolated personal workspace; Runway
does not provide teams, shared workspaces, or shared records. Deployment guidance is in
[deploy/README.md](deploy/README.md).

This public source snapshot excludes the original import history, user records, CVs,
attachments, environment files, and private infrastructure scripts.

## Layout

| Path | Contents |
| --- | --- |
| `app/(app)/` | Signed-in pages: 今日, 岗位, 项目与比赛, 日程, 公司, 洞察, 设置 |
| `app/api/` | Route handlers; `integrations/v1` is the Muse API |
| `components/app/` | Application UI; `store.tsx` holds all client data access |
| `components/ui/` | Vendored shadcn/ui components |
| `lib/` | Domain code: `entries` (records), `scanner` and `ats` (job sources), `web` (safe fetching), `ai-*` (assistant), `reminders`, `enrichment` (assessments and icons), `company-complete`, `scheduler` |
| `scripts/migrations/` | Numbered schema migrations, applied at start-up |
| `tests/` | Unit tests, API tests and a mock model for local work |

## Local development

Requirements: Node.js 22.13 or newer, npm, and PostgreSQL 17.

1. Run `npm ci` and copy `.env.example` to `.env.local`.
2. Configure a local database and fill in `DATABASE_URL`.
3. Generate two independent secrets for `SESSION_SECRET` and `AI_SETTINGS_KEY`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Run `node --env-file=.env.local scripts/migrate.mjs`, then `npm run dev`.
5. Open `http://localhost:3000` and register with an email address and password (minimum 10
   characters).

Google sign-in is optional. Create a Google OAuth web client, configure its authorized redirect
URI as `${APP_ORIGIN}/api/auth/google/callback`, and set `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET`. Runway does not automatically link a Google identity to a password
account with the same email; they remain separate accounts. Email verification and password
recovery are not implemented.

AI is optional and subject to each account's `ai_enabled` permission. With the default
`AI_MODE=personal`, users configure their own compatible endpoint, model, API key, and optional
Tavily key in Settings; deployment credentials are never used as a fallback. `AI_MODE=managed`
uses only the deployment's `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, and `TAVILY_API_KEY`, and
users cannot view, edit, or test those credentials. The application uses the fixed
`Asia/Hong_Kong` product timezone. Keep `SCHEDULER=off` during development. For isolated tests,
`node tests/mock-ai.mjs` starts a deterministic local model fixture.

## Verification

```sh
npm test
npm run lint
npm run build
```

API and database integration tests require a disposable test database and may create or
delete fixture records. Never run them against production. See [SECURITY.md](SECURITY.md)
for deployment boundaries and private vulnerability reporting.
