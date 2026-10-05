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

## 0.1.0 — 首个正式上线版本

- 岗位记录、招聘阶段与面试日程管理。
- AI 助手、岗位评估与招聘提醒。
- 项目、比赛及兼职收入管理。
- 多用户账号隔离、附件与数据备份恢复。

设置中的「Runway 0.1.0」入口可查看更新日志，当前版本号读取自 `package.json`。
本版新增公司所属国家／地区及公司介绍，不再生成或显示 JD 原文历史与保存时间；
旧历史数据保留兼容。附件发布不再覆盖已有内容，完整备份包含全部回收站记录并校验
附件与简历；恢复使用单个数据库事务，保留已有记录和设置，支持失败后重试。

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

The orb service uses `RUNWAY_FAST_DEV=1` to enable Turbopack minification for high-latency
preview connections. This reduces script transfer but component edits can trigger a full reload
and lose unsaved browser state; source maps remain enabled. Remove this flag from
`.amp/services.yaml` and run `amp orb services ensure` when state-preserving Fast Refresh is more
important. Normal `npm run dev` and production builds keep their original settings.

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

## Maintaining the frontend and assistant

Format the files you change with `npm run format -- <paths>` and check them with
`npm run format:check -- <paths>`. Prettier is development-only; avoid repository-wide
formatting in a behavior change. The existing vendored UI components remain unchanged.

- `useDesk` owns records, editing/selection, evaluation and logos. `useAssistantPanel`,
  `useNotifications`, `useReminders`, and `useNavigationGuard` own separate contexts.
  Subscribe only to the contexts a component uses. Keep their providers under the account-keyed
  `DeskProvider`; moving one above it could retain another account's state.
- `assistant.tsx` renders the UI; `use-assistant-conversation.ts` owns the request/cache/polling
  lifecycle. Image conversion and IndexedDB access have separate modules. Keep polling bounded
  and stop tracking completed runs unless a background result remains queued.
- `agent-runtime.ts` owns durable runs and checkpoint recovery. Its lazily loaded
  `agent-planner.ts` accepts a validated request and returns proposals; it does not execute them.
  `ai-provider.ts` owns the model protocol. LangGraph remains the workflow engine, not the
  business interface. Replacing an SDK does not require changing domain writers or UI contexts.
- New proposals use `AgentCommand`, not HTTP paths. Add a model action to `agent-contract.ts`,
  map its module in `agent-capabilities.ts`, and handle its command in `agent-executor.ts`
  (or `agent-jobs.ts` for background work). Exhaustive dispatch and boundary tests catch missing
  handlers/mappings. Reuse the domain writers used by ordinary APIs. `agent-commands.ts` contains
  the read adapter for old checkpoint/browser-cache paths; do not remove it while those can exist.
- History lists contain metadata. Full historical bodies load only for an explicit version read
  or a restore proposal, bounded by the validated action count. Other business snapshots are still
  request-scoped, not global caches. No extra database pool, worker or MCP process is started.
- `agent-policy.ts` is the server-owned permission boundary. Today it uses account `ai_enabled`
  and personal/managed configuration, including forbidding model changes in managed mode.
  Capabilities are filtered for the model/UI, and grants are checked again before execution and
  before a queued job starts. Future administrator grants/plan entitlements belong in this resolver,
  not browser state or prompts. There is **no admin panel, subscription system or billing ledger yet**.
  Add authoritative usage accounting and quota reservation before offering paid AI usage; the
  current hourly request limit is not a token/cost budget.

### Future Gmail MCP integration

No external MCP client or Gmail connection is installed yet. Start with a server-side, user-scoped
read adapter behind planning (`search`/`read`), with explicit tools and OAuth scopes. Keep credentials
encrypted outside prompts/checkpoints, limit retrieved text/attachments, and treat email bodies as
untrusted data. An MCP server's read-only annotation is not an authorization decision. Do not expose
arbitrary MCP URLs or launch commands to users without endpoint and deployment controls.

Sending, forwarding or deleting mail needs a separate, explicitly granted command, confirmation of
the exact recipients/content, and a durable external-operation job. Never send mail inside
`atomicAgentWrite`: serializable database retries can repeat external side effects. Commit intent
first, invoke the provider outside the transaction, and reconcile uncertain results before retrying.
Use provider idempotency where supported; a timeout is not proof that sending failed. Check live
permissions again at dispatch. LangGraph can retain confirmation/recovery while an MCP adapter or
OpenAI SDK handles transport; switching the workflow engine is not a prerequisite.
