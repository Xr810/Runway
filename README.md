# Runway

**把求职、项目、比赛和兼职收入放在一个地方管理，配合需要确认才能执行变更的 AI 助手。**

Runway 是以中文界面为主的自托管 Web 应用：记录机会、跟进招聘阶段、安排面试和提醒，也可以让助手从岗位链接、文字或截图中整理信息、评估岗位及补全公司资料。每个账号拥有独立的个人工作区，**不提供团队共享或协作记录**。

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 17 · LangGraph

[快速开始](#快速开始) · [部署](deploy/README.md) · [AI 开发与任务交接](AGENTS.md) · [安全说明](SECURITY.md)

## 能做什么

| 模块       | 用途                                                     |
| ---------- | -------------------------------------------------------- |
| 今日与日程 | 查看待办、提醒、招聘节点和面试安排                       |
| 岗位       | 管理投递状态、招聘阶段、JD、附件和岗位评估               |
| 项目与比赛 | 跟踪求职以外的机会、进度和截止日期                       |
| 兼职与收入 | 记录兼职工作和收入                                       |
| 公司与关注 | 管理公司资料、招聘来源；启用自动化后按配置时间扫描机会   |
| 洞察       | 汇总记录与评估结果，辅助选择优先级                       |
| AI 助手    | 读取上下文、整理信息、提出变更，确认后执行或提交后台任务 |
| 设置与数据 | 个人背景、简历、AI 配置、集成、回收站和备份恢复          |

AI 是可选能力，不是手动管理记录的前提。链接读取受来源网站限制，评估与补全结果需要人工核对。后台自动化需要配置模型、启用相应功能并运行调度器，不保证任意招聘网站都能抓取。

## 快速开始

需要 **Node.js ≥ 22.13、npm、PostgreSQL 17**。

### 1. 安装并准备配置

```sh
git clone https://github.com/Xr810/Runway.git
cd Runway
npm ci
cp .env.example .env.local
```

创建一个专用空数据库，将连接串填入 `.env.local` 的 `DATABASE_URL`。数据库角色应拥有应用 schema，但**不能是 superuser，也不能有 `BYPASSRLS`**，否则会绕过行级安全隔离。已有旧版业务数据的数据库可能被多账号迁移拒绝；不要直接套用到生产库。

分别运行两次下面的命令，为 `SESSION_SECRET` 和 `AI_SETTINGS_KEY` 生成不同的随机值，只写入本地配置：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

主要配置如下；完整变量见 [`.env.example`](.env.example)。

| 变量              | 说明                                                 |
| ----------------- | ---------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL 连接串                                    |
| `APP_ORIGIN`      | 应用实际访问来源，须包含协议及必要的端口             |
| `SESSION_SECRET`  | 独立随机会话密钥，至少 32 字符                       |
| `AI_SETTINGS_KEY` | 独立随机 AI 配置加密密钥，至少 32 字符；需妥善保存   |
| `ATTACHMENTS_DIR` | 附件目录，默认开发配置为 `./data/attachments`        |
| `SCHEDULER`       | 开发保持 `off`；同时关闭定时调度和 agent 后台 worker |
| `AI_MODE`         | 默认 `personal`；也支持部署方统一配置的 `managed`    |

### 2. 迁移并启动

确认连接的是自己的开发数据库后运行：

```sh
node --env-file=.env.local scripts/migrate.mjs
npm run dev
```

在本机浏览器打开开发服务器输出的地址，使用邮箱与密码注册，密码至少 10 字符。**普通 `npm run dev` / `npm start` 不自动迁移；Docker 容器启动会先执行迁移。**

如果在 Amp orb 中开发，仓库提供 [`.agents/setup`](.agents/setup) 和 [服务配置](.amp/services.yaml)。环境准备完成后运行 `amp orb services ensure`，使用它返回的 Portal 链接。该环境专为可丢弃的开发数据配置，不要用于生产。

### 3. 按需启用 AI 与登录方式

- **个人模式（`personal`）**：在设置中填写兼容的模型端点、模型名和 API key；可另配 Tavily 搜索 key。不会回退使用部署方的 AI 密钥。
- **托管模式（`managed`）**：仅使用部署环境中的 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` 和 `TAVILY_API_KEY`；用户不能查看、修改或测试这些凭据。
- 两种模式均受账号的 `ai_enabled` 服务端权限控制。调用 AI／搜索时，相关内容会发送到所配置的服务商，请先确认其隐私政策。
- Google 登录可选：设置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`，并授权 `${APP_ORIGIN}/api/auth/google/callback` 回调地址。

当前**没有邮箱验证和密码找回**。Google 身份与同邮箱密码账号不会自动合并。产品日期和调度使用固定的 `Asia/Hong_Kong` 时区（UTC+8），并非浏览器本地时区。

## 部署与数据安全

使用根目录 `Dockerfile` 构建，具体步骤和升级约束见 [部署文档](deploy/README.md)。生产部署需要 HTTPS、独立数据库、持久化附件目录，以及数据库和文件的配套备份。

- 容器启动会执行所有待处理迁移；升级前先备份并验证恢复，不能把“启动容器”当成无数据库副作用的操作。
- 完整导出包含回收站、附件和简历。恢复会校验文件，数据库写入在单个事务中执行，保留已有记录和设置，并支持失败后重试。
- 数据库与文件系统不构成同一个原子事务；恢复失败可能留下不可通过应用访问的文件残留，不能承诺零残留。
- 不要提交环境密钥、简历、附件或数据库导出。漏洞报告方式与安全边界见 [SECURITY.md](SECURITY.md)。

## 代码导航

| 路径                  | 职责                                                    |
| --------------------- | ------------------------------------------------------- |
| `app/(app)/`          | 登录后的页面与布局                                      |
| `app/api/`            | HTTP 接口；`integrations/v1` 为 Muse 集成 API           |
| `components/app/`     | 业务 UI、记录 Store、独立 Context 与助手会话生命周期    |
| `components/ui/`      | shadcn/ui 基础组件                                      |
| `lib/`                | 记录、附件、备份、扫描、AI 工作流、权限和调度等领域逻辑 |
| `scripts/migrations/` | 按编号执行的数据库迁移                                  |
| `tests/`              | 单元、数据库、API 测试及确定性模拟模型                  |
| `deploy/`             | 部署说明                                                |

业务请求经 API 进入领域模块，再访问账号隔离的 PostgreSQL 和文件存储。AI 通过“规划 → 提案 → 用户确认 → 执行”复用这些领域模块；LangGraph 负责持久工作流与恢复，不替代业务接口或权限校验。详细维护约束见 [AGENTS.md](AGENTS.md)。

## 开发与验证

```sh
npm test                 # tests/unit/*.test.ts，不包含数据库/API 集成测试
npm run lint
npx tsc --noEmit
npm run build
npm run format:check -- README.md AGENTS.md
```

只格式化本次改动的文件：`npm run format -- <paths>`。数据库测试 `npm run test:db` 与 API 测试 `npm run test:api` **只能针对一次性测试数据库和附件目录**；它们会创建、修改和删除数据。环境加载、模拟模型以及其他集成测试的注意事项见 [AGENTS.md](AGENTS.md#验证规则)。

## 当前版本与边界

当前版本为 **0.1.0**，设置中的「Runway 0.1.0」入口可查看更新日志，版本号读取自 `package.json`。本版加入公司所属国家／地区与公司介绍，加强附件并发发布和备份恢复；不再生成或显示新的 JD 原文历史及保存时间，保留旧历史兼容。

版本备注为「首个正式上线版本」，**不代表某个部署实例已经过上线验收**。当前没有团队工作区、管理员面板、订阅计费系统或 Gmail/MCP 连接。

此公开仓库不包含原始导入历史、用户记录、简历、附件、环境文件及私有基础设施脚本。继续开发前请读 [AGENTS.md](AGENTS.md)，并结合 Git 提交记录了解改动原因与未完成事项。
