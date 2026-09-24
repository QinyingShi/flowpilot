# FlowPilot 生产部署

FlowPilot 当前生产拓扑由两个部分组成：

1. Vinext 前端部署到 Sites。
2. FastAPI 与巡检 Worker 部署到支持持久化磁盘的容器平台。

当前后端使用 SQLite，因此只能运行一个 API 副本和一个巡检 Worker，且 `/data`
必须位于本机持久化磁盘。不要把 SQLite 文件放在临时文件系统、对象存储或不保证
文件锁语义的网络文件系统中。需要多副本或高可用时，应先迁移 PostgreSQL。

## 零费用方案：本机运行

当前无需公网服务时，推荐直接运行 `npm run local`。它使用本地数据库、内嵌巡检与
Git/Jira 定时同步调度器，并在启动时及每 24 小时调用 SQLite backup API，把数据库和
上传文件保存到 `backups/`。同步间隔分别由“Git 进度核验”和“版本质量预警”规则控制；
失败会记录告警并在下个周期重试。也可随时运行 `npm run backup` 手动备份。

在 `.env.local` 设置 `FLOWPILOT_LAN_ACCESS=true` 后，同一可信局域网中的设备可通过
Mac 的局域网 IP 和 3001 端口访问。主机必须保持开机，macOS 防火墙也需要允许 Node
接收入站连接。Python API 仍只监听本机地址；此开发身份模式不得直接暴露到公网。

## 推荐托管方案：Render

仓库根目录的 `render.yaml` 可创建一个 Docker Web Service，并挂载 1 GB `/data`
持久盘。由于 Render 持久盘只能由单个服务实例访问，Blueprint 会把巡检调度器嵌入
API 进程，而不是创建第二个 Worker 服务。该模式仍限定单实例；不要开启自动扩容。

在 Render Dashboard 新建 Blueprint、选择此 GitHub 仓库后，部署前填写：

- `PROJECT_BOOTSTRAP_ADMIN_EMAIL`：首位系统管理员的真实邮箱。
- `PROJECT_CORS_ORIGINS`：最终 Sites 站点的 HTTPS Origin。

GitHub 公共仓库可免 Token 读取。私有仓库连接、Jira Cloud 和 AI 文档分析默认关闭；
需要时再在服务 Environment 中增加 `GIT_ACCESS_TOKEN`、`JIRA_EMAIL`、
`JIRA_API_TOKEN` 或 `OPENAI_API_KEY`，避免首次部署被非必填凭证阻塞。

`PROJECT_API_PROXY_SECRET` 由 Render 自动生成。首次创建后从 Render 环境变量中复制
该值，作为 Sites 的同名 Secret。部署完成后访问 `/health/ready`，确认返回
`{"status":"ok"}`。

## 1. 准备生产配置

复制 `deploy/production.env.example` 为 `.env.production`，至少替换：

- `PROJECT_API_PROXY_SECRET`：不少于 32 个随机字符；前端代理与 API 必须一致。
- `PROJECT_BOOTSTRAP_ADMIN_EMAIL`：首位系统管理员邮箱。
- `PROJECT_CORS_ORIGINS`：最终 Sites 站点的 HTTPS 来源。
- `PROJECT_SEED_DEMO_DATA=false`：生产数据库不写入本地演示任务和成员数据。

生产服务会在启动阶段校验上述值以及持久化路径。发现占位密钥、开放成员模式、
相对数据库路径或非 HTTPS 来源时会直接拒绝启动。

## 2. 启动 API 与巡检 Worker

以下 Compose 方案用于自托管服务器；Render 用户跳过本节。Compose 默认使用独立
Worker，因此 `PROJECT_EMBED_INSPECTION_WORKER` 必须保持 `false`。

```bash
cp deploy/production.env.example .env.production
docker compose -f compose.production.yml build
docker compose -f compose.production.yml up -d
```

默认只把 API 暴露到宿主机 `127.0.0.1:8000`。请通过云平台入口或反向代理提供
HTTPS 域名，不要直接把容器端口暴露到公网。

部署后检查：

```bash
curl https://api.example.com/health/live
curl https://api.example.com/health/ready
```

`live` 只确认进程存活；`ready` 还会执行 SQLite 快速检查并确认核心表可查询。

## 3. 配置 Sites 前端

在 Sites 运行环境中配置：

- `PROJECT_API_BASE_URL=https://api.example.com`
- `PROJECT_API_PROXY_SECRET` 与 API 服务保持一致
- `NEXT_PUBLIC_SITE_URL` 使用最终 Sites 地址

前端只通过服务端代理访问 FastAPI，浏览器不会接触代理密钥或第三方 Token。

## 4. 备份与恢复

至少每日备份 `/data/flowpilot.db` 和 `/data/uploads`。SQLite 使用 WAL 模式，在线备份
应使用 SQLite backup API 或在停止 API 与 Worker 后复制数据库文件，不能只复制正在
写入的主数据库文件。

恢复演练应验证：登录、项目列表、WBS、计划基线、实际里程碑、需求文档、Git 证据、
Jira 质量数据和巡检闭环记录均可读取。

Render 会为持久盘创建每日快照，但仍建议定期导出应用级备份，并至少完成一次恢复
演练。挂载持久盘会使部署期间存在短暂中断，这是当前 SQLite 单实例方案的已知限制。
