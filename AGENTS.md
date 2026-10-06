# Runway: AI development and task handoff

This file applies to the entire repository. See [README.md](README.md) for the product overview and setup, [deploy/README.md](deploy/README.md) for deployment, and [SECURITY.md](SECURITY.md) for security requirements. Treat source code and actual execution results as authoritative. Historical passing results are not verification of the current changes.

## Starting or resuming a task

1. Read the user's latest goal, this file, and guidance in the directories you will change. Determine whether the request is for explanation, investigation, implementation, or delivery; do not expand its scope.
2. Run `git status --short --branch`, `git diff`, and `git diff --cached` to identify existing work. Do not overwrite someone else's changes.
3. Check `git rev-parse --is-shallow-repository`. If it returns `true`, run `git fetch --quiet --unshallow origin` before inspecting history. If the network is unavailable, state that the history is incomplete.
4. Use `git log -8`, `git log -- <relevant-paths>`, and `git show <commit>` to trace the rationale. Inspect failing tests, domain modules, and callers rather than relying on UI behavior or commit titles alone.
5. An `Amp-Thread-ID` commit trailer links to discussion, commands, and verification evidence. Read it when accessible. Otherwise, rely on commit messages, diffs, and tests; do not assume private discussions are available.
6. State the intended behavior change, boundaries to preserve, and verification approach, then make the smallest verifiable change. Distinguish facts, assumptions, and recommendations.

## Project map and stable boundaries

Runway is a personal opportunity tracker with isolated accounts, not a team collaboration system. It uses Node.js ≥22.13, Next.js App Router, React, PostgreSQL 17, and LangGraph, with npm and `package-lock.json`. Product time follows the shared `Asia/Hong_Kong` utilities, including `lib/appointments.ts`; do not reinterpret dates in the developer machine's timezone.

| Task                                          | Start here                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pages and record editing                      | `app/(app)/`, `components/app/views/`, `components/app/store.tsx`                                            |
| Records, revisions, and history compatibility | `lib/entries.ts`, `lib/model.ts`, `app/api/desk/route.ts`                                                    |
| Accounts and tenant isolation                 | `lib/auth.ts`, `lib/accounts.ts`, `lib/postgres.ts`, isolation migrations                                    |
| Attachments, CVs, and backup/restore          | `lib/attachments.ts`, `lib/files.ts`, `lib/cv.ts`, `lib/backup.ts`                                           |
| Recruiting sources, fetching, and automation  | `lib/scanner.ts`, `lib/ats.ts`, `lib/web.ts`, `lib/scheduler.ts`                                             |
| Assistant UI and conversations                | `components/app/assistant.tsx`, `use-assistant-conversation.ts`, `assistant-cache.ts`, `assistant-images.ts` |
| Durable AI workflows                          | `lib/agent-runtime.ts`, `agent-graph.ts`, `agent-checkpoint.ts`                                              |
| Models, planning, and permissions             | `lib/ai-provider.ts`, `ai-config.ts`, `agent-planner.ts`, `agent-policy.ts`                                  |
| Commands and execution                        | `lib/agent-contract.ts`, `agent-capabilities.ts`, `agent-executor.ts`, `agent-jobs.ts`                       |

### Data isolation and side effects

- Business database operations use the user context and business `pool` in `lib/postgres.ts`. `controlPool` is for control-plane operations such as identity/session/token lookup and background account enumeration, not a shortcut around tenant isolation.
- Do not trust an owner supplied in a request or permissions held in browser state. The application database role must not be a superuser or have `BYPASSRLS`; isolation tests must detect unauthorized access.
- Preserve revision conflict detection. Do not silently overwrite stale edits. Add migrations under `scripts/migrations/`; do not rewrite published migrations to change existing databases.
- The serializable transaction in `atomicAgentWrite` may retry. Never put irreversible external operations, such as sending email, inside it. Persist intent first, invoke the external service outside the transaction, and reconcile uncertain outcomes before retrying.
- Attachment publication must not overwrite different content at the same path. Restore must preserve existing data, validate attachments and CVs, include all recycle-bin records, and remain retryable after failure. The filesystem is not part of the database transaction.

### Frontend and assistant boundaries

- `useDesk` owns records, editing/selection, assessments, and logos. `useAssistantPanel`, `useNotifications`, `useReminders`, and `useNavigationGuard` subscribe to separate contexts.
- Keep these providers inside the account-keyed `DeskProvider` so switching accounts cannot retain another account's state. Do not merge them back into a global store for convenience.
- `assistant.tsx` handles presentation; `use-assistant-conversation.ts` owns requests, caching, and polling. Keep image conversion and IndexedDB access separate. Polling must be bounded; stop tracking completed runs unless a background result remains queued.
- `agent-runtime.ts` owns durable runs and checkpoint recovery. The lazily loaded `agent-planner.ts` accepts validated requests and returns proposals; it does not execute them.
- New capabilities use `AgentCommand`: define the action in `agent-contract.ts`, map its module in `agent-capabilities.ts`, and handle it in `agent-executor.ts` or `agent-jobs.ts`. Reuse the domain writers used by ordinary APIs. Add exhaustive-dispatch and boundary tests.
- `agent-commands.ts` still reads legacy HTTP-path proposals. Do not remove this adapter while old checkpoints or browser caches can exist.
- History lists load metadata only. Load bodies on demand for explicit version reads or restore proposals, bounded by the validated action count. Business snapshots are request-scoped, not cross-account global caches.
- `agent-policy.ts` is the server-owned permission boundary. Check live permissions when generating proposals, confirming execution, and starting background jobs. Filtering model/UI capabilities is not final authorization.
- `personal` mode never falls back to environment AI keys. `managed` mode does not let users view, change, or test deployment credentials. LangGraph owns workflow; `ai-provider.ts` owns model protocol. Replacing an SDK should not require rewriting the domain layer or UI.

## Recent changes and rationale

The following is background traceable to committed history, not a task backlog or a fresh verification report.

| Change                                                                                                              | Rationale                                                                                                                                               | Preserve when continuing                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Assistant boundary refactor](https://github.com/Xr810/Runway/commit/2c0da8707992f198e592875fbb2435be2659a66a)      | Reduce frontend store coupling; separate model planning, durable workflow, and business execution; prevent old proposals from bypassing new permissions | Account-scoped providers, domain commands, live execution policy, legacy proposal compatibility, bounded history loading and polling       |
| [0.1.0 recovery and release notes](https://github.com/Xr810/Runway/commit/81791ff86d78e28fa03c786e7c31f6d2040ca2bc) | Fix concurrent attachment overwrites, incomplete recycle-bin exports, and partial restores; add company fields and a version entry                      | No attachment overwrites, complete exports, transactional restore and retry, revision checks, legacy job-description history compatibility |

The [original development thread](https://ampcode.com/threads/T-01a10cd9-e108-763a-bfbb-4df8cd57b92c) contains discussion and verification details. It may require access; the summary above and Git diffs should provide a usable public starting point. Historical checks included unit tests, TypeScript, ESLint, isolation/backup regressions, and mock-model run recovery. They are not a test report for the current branch.

At that handoff, the code had been pushed, but no manual deployment or GitHub Release had been performed, and production deployment status had not been verified. Recheck delivery status rather than treating the Settings label “first official release” as production acceptance evidence.

**Not implemented:** team sharing, an admin panel, subscription/billing ledgers, token/cost quotas, an external MCP client, or Gmail connections. An hourly request limit is not a cost budget. Do not describe these plans as existing features.

If a future task involves Gmail/MCP, start with a server-side, user-scoped read-only `search/read` adapter with explicit tools and OAuth scopes. Keep credentials encrypted and out of prompts/checkpoints; treat email and attachments as untrusted input and bound their size. An MCP read-only annotation is not authorization. Do not expose arbitrary MCP URLs or launch commands. Sending, forwarding, and deleting require separate grants, explicit confirmation of targets/content, durable external-operation jobs, and reconciliation of uncertain results. These are design constraints, not instructions to implement the integration now.

## Verification

Read `package.json` and the target test files first. Keep the different test entry points distinct.

| Check              | Command and prerequisites                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Unit tests         | `npm test`; matches only `tests/unit/*.test.ts`                                                                          |
| Static checks      | `npm run lint`, `npx tsc --noEmit`                                                                                       |
| Production build   | `npm run build`; a successful build is not runtime or deployment acceptance                                              |
| Formatting         | `npm run format -- <changed-files>`, `npm run format:check -- <changed-files>`; no repository-wide formatting            |
| Database isolation | `npm run test:db`; requires a migrated disposable database and `DATABASE_URL`                                            |
| API                | `npm run test:api`; requires a running app, the same test database, isolated attachment storage, and `tests/mock-ai.mjs` |

Next.js loads `.env.local`; standalone Node tests and migration scripts do not load it automatically. For example, **after confirming that `.env.test.local` points only to disposable test resources**, run:

```sh
node --env-file=.env.test.local scripts/migrate.mjs
node --env-file=.env.test.local --test --import tsx tests/tenant-isolation.test.ts
node --env-file=.env.test.local --test tests/api.test.mjs
```

Prepare the test configuration yourself and never commit it. The API test process and application process must use the same database and attachment root. Use `AI_MODE=personal` and set `BASE_URL` / `TEST_ORIGIN` to match the application's origin. The mock model listens on port 4010 by default; `TEST_AI_BASE_URL` overrides its address. `SCAN_LIVE=1` accesses a real recruiting source and should not be enabled by default.

Files such as `tests/backup.test.ts`, `tests/agent-runtime.integration.ts`, and `tests/integration/scanner-retry.test.ts` are not part of `npm test`. They have their own database-name, mode, or connection requirements; read their headers and setup before running them. Some tests use `TRUNCATE`; API tests delete records and recursively remove test-account attachment directories. **Never run them against production or shared business data, and do not weaken their safety guards to force a run.**

Scale verification to risk: check formatting, paths, and command accuracy for documentation; run targeted regressions for local behavior changes; add static checks, relevant integration tests, and a build for shared-boundary changes. Tests should fail for plausible wrong implementations, especially cross-account access, concurrent edits, duplicate confirmations, recovery failures, and permission changes.

For visual UI changes, render affected states and inspect screenshots. For interaction changes, exercise the behavior and check DOM/accessibility state. Use synthetic data in screenshots; never expose emails, CVs, or keys. Report checks that could not run and their blockers rather than claiming they passed.

## Development environment and operational safety

- Keep `SCHEDULER=off` during development; it also disables the agent background worker. Queued work is not completed work. Enable the worker explicitly only in an isolated environment when testing it.
- In Amp orbs, start repository services with `amp orb services ensure`; use managed services for other long-running test processes. Share the actual returned Portal URL, not an orb loopback address.
- `RUNWAY_FAST_DEV=1` in `.amp/services.yaml` optimizes transfer for high-latency previews only. Component edits may cause a full reload and lose unsaved state. Remove the flag and restart services when state-preserving Fast Refresh matters; do not claim production performance gains from it.
- `.agents/setup` contains PostgreSQL durability settings suitable only for disposable development data. Never copy them into production.
- Do not print or commit `.env.local`, database contents, attachments, CVs, session cookies, provider keys, integration tokens, or backups.
- Obtain explicit user authorization before migrating shared/production databases, deploying, pushing, creating/merging PRs, publishing releases, or taking destructive actions. Remember that Docker startup runs migrations.

## Recording changes and handing off to the next AI

**Git records completed changes and their rationale; handoffs record current state and where to resume; this file holds lasting conventions and important decisions.** Do not append every tool output here or describe planned work as completed.

- Commit bodies should explain the problem, chosen approach, compatibility/migration implications, and verification results. Preserve `Amp-Thread-ID` when supported so the discussion remains traceable. If committing or pushing is not authorized, retain the working changes and state that clearly.
- When pausing or finishing a task, use the template below in the final reply. If the user needs a persisted cross-session handoff, use their designated task document. If none exists, `TASKS.md` may be added, but do not create an empty task file or put private data in public documents.
- A resuming agent must check current Git state and code before following the handoff: status can become stale. Remove completed items from the backlog, promote lasting decisions to the relevant documentation, and do not rely exclusively on a platform-private thread.

```text
Goal: Requested outcome and explicit non-goals.
State: Complete / in progress / blocked; current branch, commits, and uncommitted paths.
Rationale: Original problem, evidence, chosen approach, and important tradeoffs; separate facts from assumptions.
Verification: Actual commands, results, skipped checks and reasons; synthetic-data evidence for UI checks.
Remaining work: Concrete tasks, known risks, or required approvals; distinguish recommendations from commitments.
Resume here: Next executable action, entry files, and a safe reproduction procedure.
Delivery: Report local edits, commits, pushes, merges, and deployment status separately.
```
