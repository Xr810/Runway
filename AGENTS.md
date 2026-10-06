# Runway：AI 开发与任务交接

本文件适用于整个仓库。面向人的产品介绍、启动说明见 [README.md](README.md)；部署和安全要求分别见 [deploy/README.md](deploy/README.md)、[SECURITY.md](SECURITY.md)。以代码和实际执行结果为准，不把历史交接中的“通过”当成本次验证。

## 开始或恢复任务

1. 阅读用户最新目标、此文件和改动目录内的指导文件。先分清是解释、调查、实现还是发布，不擅自扩大范围。
2. 运行 `git status --short --branch`、`git diff`、`git diff --cached`，识别已有未提交工作；不要覆盖他人的改动。
3. 检查 `git rev-parse --is-shallow-repository`；若为 `true`，先 `git fetch --quiet --unshallow origin`，再读历史。网络不可用时说明历史不完整。
4. 通过 `git log -8`、`git log -- <相关路径>`、`git show <commit>` 追踪原因；优先定位失败测试、领域模块与调用者，不只看界面或提交标题。
5. 提交中的 `Amp-Thread-ID` 是进一步的讨论、命令和验证证据入口；能访问时再读取。不能访问时依靠提交正文、差异和测试，不假设私有讨论可见。
6. 说明本次准备改变的行为、必须保留的边界和验证方式，再做最小可验证修改。遇到不确定项，区分事实、假设和建议。

## 项目地图与稳定边界

Runway 是多账号隔离的个人机会管理应用，不是团队协作系统。Node.js ≥22.13、Next.js App Router、React、PostgreSQL 17、LangGraph；使用 npm 和 `package-lock.json`。产品时间遵循 `lib/appointments.ts` 等共享时间工具的 `Asia/Hong_Kong`，不要按开发机器时区重新解释日期。

| 任务                      | 优先入口                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 页面、记录编辑            | `app/(app)/`、`components/app/views/`、`components/app/store.tsx`                                            |
| 记录、revision 与历史兼容 | `lib/entries.ts`、`lib/model.ts`、`app/api/desk/route.ts`                                                    |
| 账号与租户隔离            | `lib/auth.ts`、`lib/accounts.ts`、`lib/postgres.ts`、隔离迁移                                                |
| 附件、简历、备份恢复      | `lib/attachments.ts`、`lib/files.ts`、`lib/cv.ts`、`lib/backup.ts`                                           |
| 招聘来源、抓取与自动化    | `lib/scanner.ts`、`lib/ats.ts`、`lib/web.ts`、`lib/scheduler.ts`                                             |
| AI 交互与会话             | `components/app/assistant.tsx`、`use-assistant-conversation.ts`、`assistant-cache.ts`、`assistant-images.ts` |
| AI 持久工作流             | `lib/agent-runtime.ts`、`agent-graph.ts`、`agent-checkpoint.ts`                                              |
| 模型、规划与权限          | `lib/ai-provider.ts`、`ai-config.ts`、`agent-planner.ts`、`agent-policy.ts`                                  |
| 命令与执行                | `lib/agent-contract.ts`、`agent-capabilities.ts`、`agent-executor.ts`、`agent-jobs.ts`                       |

### 数据隔离与副作用

- 业务数据库操作通过 `lib/postgres.ts` 的用户上下文和业务 `pool`；`controlPool` 只用于身份/session/token 查找及后台账号枚举等控制用途，不能作为绕过租户隔离的捷径。
- 不信任请求中的 owner 或浏览器权限。应用数据库角色不得是 superuser 或具有 `BYPASSRLS`；隔离测试必须能发现越权访问。
- 保留 revision 冲突检测，不以静默覆盖解决过期编辑。新增迁移放在 `scripts/migrations/`，不要改写已发布迁移来改变现有数据库。
- `atomicAgentWrite` 的 serializable 事务可能重试。邮件发送等不可逆外部操作不能放在其中；先持久化意图，在事务外调用，并在结果不确定时核对后再重试。
- 附件发布不能覆盖同路径不同内容。恢复必须保留已有数据、校验附件与简历、覆盖全部回收站记录，并保持失败可重试；文件系统不是数据库事务的一部分。

### 前端与助手边界

- `useDesk` 负责记录、编辑/选择、评估与图标；`useAssistantPanel`、`useNotifications`、`useReminders`、`useNavigationGuard` 订阅各自 Context。
- 这些 Provider 必须留在按账号 key 挂载的 `DeskProvider` 内，防止切换账号残留另一账号状态。不要为了便捷重新合并成全局 Store。
- `assistant.tsx` 负责呈现；`use-assistant-conversation.ts` 负责请求、缓存与轮询生命周期；图片转换和 IndexedDB 访问保持独立。轮询须有界，已结束且没有待返回后台结果的运行应停止跟踪。
- `agent-runtime.ts` 负责持久运行与 checkpoint 恢复；懒加载的 `agent-planner.ts` 接收已验证请求并返回提案，不直接执行提案。
- 新能力使用 `AgentCommand`：在 `agent-contract.ts` 定义动作，在 `agent-capabilities.ts` 映射模块，在 `agent-executor.ts` 或 `agent-jobs.ts` 实现，并复用普通 API 的领域 writer。补充穷尽分发和边界测试。
- `agent-commands.ts` 仍读取旧 HTTP-path 提案；旧 checkpoint 或浏览器缓存可能存在时不能删除兼容适配。
- 历史列表只读元信息，正文仅在显式版本读取或恢复提案时按需加载，并受已验证动作数量限制。业务 snapshot 是请求级数据，不是跨账号全局缓存。
- `agent-policy.ts` 是服务端权限来源；生成提案、确认执行和后台任务启动均需检查当时权限。模型/UI 能力过滤不是最终授权。
- `personal` 不回退到环境 AI 密钥；`managed` 不允许用户查看、修改或测试部署凭据。LangGraph 管工作流，`ai-provider.ts` 管模型协议；换 SDK 不应迫使业务层或 UI 重写。

## 近期演进与设计原因

以下是可从已提交历史追溯的背景，不是未来任务清单，也不是本次重新验证结果。

| 变更                                                                                                        | 为什么这样做                                                                    | 继续修改时要保留什么                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [助手边界重构](https://github.com/Xr810/Runway/commit/2c0da8707992f198e592875fbb2435be2659a66a)             | 降低前端 Store 耦合；将模型规划、持久工作流和业务执行分开；避免旧提案绕过新权限 | 账号级 Provider、领域命令、执行时权限复查、旧提案兼容、有界历史加载与轮询 |
| [0.1.0 数据恢复与版本说明](https://github.com/Xr810/Runway/commit/81791ff86d78e28fa03c786e7c31f6d2040ca2bc) | 修复附件并发覆盖、回收站导出遗漏及部分恢复；补充公司字段与版本入口              | 不覆盖附件、完整导出、事务恢复与重试、revision 校验、旧 JD 历史兼容       |

两次提交的讨论与验证过程见 [原开发线程](https://ampcode.com/threads/T-01a10cd9-e108-763a-bfbb-4df8cd57b92c)。线程可能需要访问权限；上述摘要和 Git 差异应足够作为公开起点。历史验证包括单元测试、TypeScript、ESLint、隔离/备份回归与模拟模型运行恢复；这不是当前分支的测试报告。

当时已推送代码，但未手动部署或创建 GitHub Release，也未验证生产部署状态。后续代理必须重新检查当前交付状态，不将设置页的「首个正式上线版本」文案当作生产验收证据。

**尚未实现：**团队共享、管理员面板、订阅/计费账本、token/成本配额、外部 MCP 客户端与 Gmail 连接。小时请求限额不等于成本预算，不把这些计划宣传为现成功能。

若任务将来涉及 Gmail/MCP：先做服务端用户级只读 `search/read` 适配，限定工具和 OAuth scope；凭据加密保存且不进入提示词/checkpoint，邮件及附件视为不可信输入并限制大小。MCP 的只读标注不是授权，不暴露任意 MCP URL 或启动命令。发送、转发、删除需独立授权、明确确认对象/内容、持久外部任务及不确定结果核对。这是设计约束，不是要求现在实现。

## 验证规则

先看 `package.json` 与目标测试文件；不要把不同测试入口混为一谈。

| 检查       | 命令与前提                                                                               |
| ---------- | ---------------------------------------------------------------------------------------- |
| 单元测试   | `npm test`，仅匹配 `tests/unit/*.test.ts`                                                |
| 静态检查   | `npm run lint`、`npx tsc --noEmit`                                                       |
| 生产构建   | `npm run build`；构建成功不等于运行或部署验收                                            |
| 格式       | `npm run format -- <改动文件>`、`npm run format:check -- <改动文件>`；不要全仓格式化     |
| 数据库隔离 | `npm run test:db`，需要已迁移的一次性数据库与 `DATABASE_URL`                             |
| API        | `npm run test:api`，需要运行中的应用、同一测试数据库、独立附件目录及 `tests/mock-ai.mjs` |

Next.js 会读取 `.env.local`，独立 Node 测试和迁移脚本不会自动读取。例如在**确认 `.env.test.local` 仅指向一次性测试资源后**可运行：

```sh
node --env-file=.env.test.local scripts/migrate.mjs
node --env-file=.env.test.local --test --import tsx tests/tenant-isolation.test.ts
node --env-file=.env.test.local --test tests/api.test.mjs
```

测试配置文件需要自行准备且不得提交。API 测试的应用进程与测试进程必须使用同一数据库和附件根目录；使用 `AI_MODE=personal`，设置匹配应用来源的 `BASE_URL` / `TEST_ORIGIN`。模拟模型默认监听 4010，`TEST_AI_BASE_URL` 可覆盖地址。`SCAN_LIVE=1` 会访问真实招聘来源，不应默认开启。

`tests/backup.test.ts`、`tests/agent-runtime.integration.ts`、`tests/integration/scanner-retry.test.ts` 等不属于 `npm test`，有各自数据库名称、模式或连接要求，运行前读文件头与 setup。某些测试会 `TRUNCATE`；API 测试会删除记录并递归删除测试账号附件。**禁止在生产或共享业务数据上运行它们；也不要放宽安全检查来强行运行。**

验证规模按风险选择：文档检查格式、路径和命令真实性；局部行为跑定向回归；共享边界变更补静态检查、相关集成与构建。测试应覆盖错误实现会失败的场景，尤其是跨账号访问、并发修改、重复确认、失败恢复与权限变化。

UI 外观变更必须实际渲染受影响状态并检查截图；交互变更实际操作并核对 DOM/无障碍状态。截图只用合成数据，不公开邮箱、简历、密钥。不能运行的检查说明阻碍，不声称已通过。

## 开发环境与操作安全

- 开发默认 `SCHEDULER=off`，这也关闭 agent 后台 worker；不要将排队状态误认为已完成。需要验证 worker 时仅在隔离环境显式启用。
- Amp orb 使用 `amp orb services ensure` 启动仓库服务；其他长驻测试服务使用受管 service。使用实际返回的 Portal URL 分享预览，不分享 orb 的回环地址。
- `.amp/services.yaml` 中 `RUNWAY_FAST_DEV=1` 只优化高延迟预览传输；组件编辑可能整页刷新并丢失未保存状态。需要保留 Fast Refresh 状态时可移除该标志再重启服务；不据此宣称生产性能改善。
- `.agents/setup` 包含仅适用于可丢弃开发数据的 PostgreSQL 持久性设置，不可照搬到生产。
- 不打印或提交 `.env.local`、数据库内容、附件、简历、session cookie、provider key、集成 token 和备份。
- 迁移共享/生产数据库、部署、推送、创建/合并 PR、发布版本及破坏性操作必须获得用户明确授权。注意 Docker 启动自带迁移副作用。

## 如何记录改动过程并交给下一个 AI

**Git 记录已完成的变更与原因；任务交接记录当前状态与接续入口；本文件只保留长期约定和关键决策。** 不要把每次工具输出追加到这里，也不要把“计划执行”写成“已经完成”。

- 提交正文说明解决什么问题、为什么选择此方案、兼容性/迁移影响及验证结果；若工具支持，保留 `Amp-Thread-ID` 以回溯讨论。用户未授权提交或推送时，保留工作区改动并如实说明。
- 任务暂停或结束时，在最终回复中按下面的模板交接。若用户需要跨会话落盘，使用其指定的任务文档；没有现成文档时可新增 `TASKS.md`，但不要为空任务创建文件，也不要在公开文件留下私有数据。
- 新代理先检查当前 Git 状态和实际代码，再使用交接中的下一步；状态会过时。完成项应移出待办，长期决策同步到相关文档，不依赖某一平台的私有线程。

```text
目标：用户要的结果及明确不做的事。
状态：已完成 / 进行中 / 阻塞；当前分支、已提交变更和未提交路径。
原因：原问题、证据、选定方案及重要取舍；区分事实与假设。
验证：实际命令、结果、未运行项及原因；UI 附合成数据的检查证据。
剩余：明确的待办、已知风险或所需授权，不把建议写成承诺。
接续：下一项可执行动作、入口文件、可安全复现的方法。
交付：分别说明本地修改、提交、推送、合并、部署的真实状态。
```
