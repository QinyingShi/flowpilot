# FlowPilot

FlowPilot 是一个面向软件研发团队的 AI 项目管理工作台。它把版本计划、WBS、里程碑、资源负载、风险、需求变更、会议与自动巡检放在同一个工作流中，并提供可回溯的计划基线和实际完成记录。

> 当前版本：`0.1.0-alpha`。适合本地体验、产品验证和二次开发；在接入真实组织前，请先完成生产级身份认证、权限审计、第三方连接器联调和数据库迁移。

![FlowPilot 项目概览](./public/og.png)

## 已实现能力

- 多版本项目概览、计划/实际/预测趋势和版本时间轴
- WBS 列表与看板、父子任务、敏捷/瀑布模式、阻塞闭环
- 里程碑、关键路径、计划基线、实际完成时间和历史回溯
- 团队负载、成员能力画像、任务筛选和 AI 调配建议
- 需求变更从创建、分析、审核、并入版本、实施到归档的闭环
- 风险巡检、预警、处置建议、通知和审计记录
- 会议预约、会议纪要、决策跟进和历史会议归档
- 日报、周报、版本计划等项目报告
- 本地开发身份切换、工作区成员、角色与项目级权限
- Word、PDF、XMind、Axure 等需求材料的上传与任务拆分入口

## 功能状态

| 范围                                        | 当前状态                                                     |
| ------------------------------------------- | ------------------------------------------------------------ |
| 项目、版本、WBS、风险、变更、会议等核心流程 | 本地后端和 SQLite 可持久化使用                               |
| AI 需求文档分析                             | 已接 OpenAI 服务端调用；需自行配置 API Key                   |
| AI 巡检与建议                               | 规则巡检可运行；模型增强和业务规则仍需按团队校准             |
| GitHub 连接器                               | 支持真实仓库校验、定时同步、WBS 关联、失败预警和巡检闭环     |
| Jira 连接器                                 | 支持 Cloud 缺陷同步、WBS 关联、版本质量门禁、预警和自动重试  |
| 飞书、钉钉、在线表格等连接器                | 提供沙箱配置、测试和同步框架；真实生产连接仍需凭证与接口联调 |
| 登录与身份切换                              | 本地开发身份切换可用；生产环境应接入企业 SSO/OIDC            |
| 数据库                                      | 单机 SQLite 可用；多实例生产部署建议迁移 PostgreSQL          |
| Sites / Cloudflare D1、R2                   | 保留部署结构和数据 Schema；当前完整业务仍以 Python API 为准  |

## 架构

```text
浏览器
  │
  ▼
Vinext / React 前端
  │  /api/workspace 代理（携带当前用户与项目上下文）
  ▼
FastAPI 业务服务 ─── 自动巡检 Worker
  │
  ├── SQLite（项目业务数据）
  ├── 本地上传目录（需求文档）
  └── OpenAI / 第三方连接器（按需配置）
```

前端保留了 Sites 所需的 D1/R2 Schema，但本仓库当前最完整、经过测试的运行方式是 Vinext + FastAPI + SQLite。

## 快速开始

环境要求：

- Node.js `22.13+`
- Python `3.11+`

安装依赖：

```bash
npm install
npm run setup:api
cp .env.example .env.local
```

启动前端、API 和巡检 Worker：

```bash
npm run dev
```

不购买云服务、在本机持续使用时运行：

```bash
npm run local
```

该模式使用本地 SQLite、把巡检和 Git 定时同步调度器嵌入 API，并在启动时及此后每
24 小时备份到 `backups/`。Mac 关机或进程退出后，其他设备将无法访问，自动同步也会
暂停，但已有数据不会丢失。

如需让同一可信 Wi-Fi 下的设备临时访问，在 `.env.local` 设置
`FLOWPILOT_LAN_ACCESS=true` 后重新运行。此模式没有公网认证边界，禁止直接暴露到互联网。

打开：

- 工作台：<http://localhost:3001>
- API 健康检查：<http://127.0.0.1:8000/health>
- API 文档：<http://127.0.0.1:8000/docs>

如果 `8000` 端口已被占用，通常说明 API 已经启动。先访问健康检查确认，不要重复启动同一服务。

## 环境配置

以 [`.env.example`](./.env.example) 为模板。生产环境至少需要：

- 设置 `PROJECT_ENV=production`
- 为前端代理和 API 配置相同的 `PROJECT_API_PROXY_SECRET`
- 设置首位管理员 `PROJECT_BOOTSTRAP_ADMIN_EMAIL`
- 保持成员模式为 `invite_only`
- 将站点地址写入 `NEXT_PUBLIC_SITE_URL`
- 如启用 AI 文档分析，安全地注入 `OPENAI_API_KEY`

如启用 GitHub 真实同步：

- 公共仓库可以免 Token 免费读取；私有仓库或需要更高 API 额度时，再在服务端设置 `GIT_ACCESS_TOKEN`
- 不要把 Token 填入页面或提交到仓库
- 私有仓库建议使用细粒度 Token，并只授予 Contents（只读）和 Pull requests（只读）权限
- 在“集成与自动化中心”将 Git 设为“真实第三方”，仓库填写 `owner/repository`
- 提交信息或 PR 标题/描述引用 WBS 编号后，系统才会建立任务进度证据
- 未自动识别任务编号的提交或 PR，可在“进度与质量数据”中人工关联 WBS，关联后会立即重新巡检
- “Git 进度核验”规则可设置自动同步间隔；同步失败会进入告警闭环，并在下一周期自动重试

如启用 Jira Cloud 真实同步：

- 在服务端设置 `JIRA_EMAIL` 和 `JIRA_API_TOKEN`，不要把凭证填入页面或提交到仓库
- 在“集成与自动化中心”将 Jira 设为“真实第三方”，填写站点根地址和项目代码
- 系统按版本汇总未解决 P0/P1、重开率并生成发布质量门禁；未识别 WBS 的缺陷可人工关联
- “版本质量预警”规则控制阈值和自动同步；同步失败会进入风险闭环并自动重试
- 当前邮件/API Token 方式适合本地单组织集成；面向多租户分发时应改为 OAuth 2.0 授权

不要提交 `.env`、数据库、上传文件、第三方凭证或真实组织数据。`npm run dev` 会读取根目录的 `.env` 和 `.env.local`，已有系统环境变量优先。

## 常用命令

```bash
npm run dev             # 同时启动前端、API 和巡检 Worker
npm run local           # 免费本机常驻模式，内嵌巡检并自动备份
npm run backup          # 立即生成数据库与上传文件备份
npm run dev:web         # 只启动前端
npm run dev:api         # 只启动 API
npm run dev:worker      # 只启动巡检 Worker
npm run inspection:once # 执行一次巡检
npm run test:api        # 后端测试
npm run lint            # 前端静态检查
npx tsc --noEmit        # TypeScript 类型检查
npm run build           # 生产构建
```

## 生产部署

仓库提供 `Dockerfile.api` 与 `compose.production.yml`，可将 FastAPI 和巡检 Worker
部署到带持久化磁盘的容器环境。生产环境会校验代理密钥、首位管理员、成员策略、
HTTPS 来源以及持久化路径，避免带着开发默认值启动。

完整步骤见 [`docs/deployment.md`](./docs/deployment.md)。仓库还提供 `render.yaml`，可用
Render Blueprint 创建单服务 + 持久盘的托管后端，并在同一进程运行巡检调度器。当前
SQLite 部署限定为单 API 副本；需要水平扩容前应先迁移 PostgreSQL。

## 数据与隐私

- 默认数据库位于 `backend/data/project_command_center.db`，已被 Git 忽略。
- 上传文件默认位于 `backend/data/uploads/`，已被 Git 忽略。
- 开启 AI 分析后，选定的文档内容可能发送给所配置的模型服务商；部署方应先完成数据分级、脱敏、授权和留存策略。
- 本地演示身份仅用于开发，不应作为生产认证方案。

## 参与贡献

请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告，不要直接创建公开 Issue。

## 路线图

- 生产级 OIDC/企业 SSO 与细粒度 RBAC
- PostgreSQL 和对象存储适配
- 飞书、钉钉、GitLab 的真实双向同步、Jira OAuth/双向写回，以及 GitHub Webhook 增量同步
- Webhook、幂等、失败重试和连接器可观测性
- AI 评测集、建议反馈闭环和项目级知识库
- E2E 测试、迁移工具和正式部署手册

## 许可证

本项目采用 [Apache License 2.0](./LICENSE) 开源许可证。
