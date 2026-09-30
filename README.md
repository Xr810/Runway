# Runway

Personal tracker for job applications, side projects and competitions, with an assistant that
works on the data: it reads job links and screenshots, sets reminders, adjusts the target fields,
scans watched career pages every morning and fills in missing company details.

Next.js 16 (App Router) · React 19 · PostgreSQL 17 · Docker · LangGraph.
The interface is primarily Chinese. This is a single-user application, not a multi-tenant
service. Deployment guidance is in [deploy/README.md](deploy/README.md).

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

4. Generate a scrypt login hash using `node scripts/password-hash.mjs` and paste its output
   into `LOGIN_PASSWORD_HASH`. The script prompts without echoing the password.
5. Run `node --env-file=.env.local scripts/migrate.mjs`, then `npm run dev`.
6. Open `http://localhost:3000` and sign in with your chosen password.

AI features are optional. Configure a compatible provider in Settings or set `AI_BASE_URL`,
`AI_API_KEY`, and `AI_MODEL`. Keep `SCHEDULER=off` during development. For isolated tests,
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

### 审计修复回归测试

`tests/integration/audit-regressions.test.ts` 验证五维手动评分保护、摘要/链接历史、长简历保存以及真实 ZIP 导出/恢复（含回收站附件、提醒完成历史和简历原文件）。测试会清空业务表，**只能使用名称以 `_test` 结尾的独立临时数据库**。先对该库运行迁移，再用同一 `DATABASE_URL` 启动应用；配置 `BASE_URL`、`TEST_PASSWORD` 和与应用相同的 `ATTACHMENTS_DIR` 后运行：

```sh
node --env-file=.env.local --import tsx --test tests/integration/audit-regressions.test.ts
```

业务数据 ZIP 支持读取 v1 和 v2 格式；v2 新增回收站状态及个人数据。恢复只新增缺失记录，已有个人背景/简历、提醒及其完成状态不被覆盖。旧 v1 中缺失父记录的附件会计数提示并跳过。ZIP 不包含 AI 对话/评估历史、图标缓存、密钥或服务器运行配置，不能替代数据库和文件目录的服务器备份。
