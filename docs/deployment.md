# FlowPilot 生产部署

FlowPilot 当前生产拓扑由两个部分组成：

1. Vinext 前端部署到 Sites。
2. FastAPI 与巡检 Worker 部署到支持持久化磁盘的容器平台。

当前后端使用 SQLite，因此只能运行一个 API 副本和一个巡检 Worker，且 `/data`
必须位于本机持久化磁盘。不要把 SQLite 文件放在临时文件系统、对象存储或不保证
文件锁语义的网络文件系统中。需要多副本或高可用时，应先迁移 PostgreSQL。

## 1. 准备生产配置

复制 `deploy/production.env.example` 为 `.env.production`，至少替换：

- `PROJECT_API_PROXY_SECRET`：不少于 32 个随机字符；前端代理与 API 必须一致。
- `PROJECT_BOOTSTRAP_ADMIN_EMAIL`：首位系统管理员邮箱。
- `PROJECT_CORS_ORIGINS`：最终 Sites 站点的 HTTPS 来源。
- `PROJECT_SEED_DEMO_DATA=false`：生产数据库不写入本地演示任务和成员数据。

生产服务会在启动阶段校验上述值以及持久化路径。发现占位密钥、开放成员模式、
相对数据库路径或非 HTTPS 来源时会直接拒绝启动。

## 2. 启动 API 与巡检 Worker

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

恢复演练应验证：登录、项目列表、WBS、计划基线、实际里程碑、需求文档、Git 证据和
巡检闭环记录均可读取。
