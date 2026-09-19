# Python 后端

完整的项目说明、功能状态和安全边界请先阅读根目录的 [`README.md`](../README.md)。

工作台前端继续运行在 Vinext，业务数据通过 `/api/workspace` 代理到本目录的
FastAPI 服务。当前持久层使用 SQLite，数据库文件默认位于
`backend/data/project_command_center.db`。

首次安装：

```bash
npm run setup:api
```

同时启动前后端：

```bash
npm run dev
```

也可以分别运行 `npm run dev:api` 和 `npm run dev:web`。FastAPI 的健康检查与
接口文档分别位于 `http://127.0.0.1:8000/health` 和
`http://127.0.0.1:8000/docs`。

可选环境变量：

- `PROJECT_API_BASE_URL`：前端代理访问的 Python API 地址。
- `PROJECT_DB_PATH`：SQLite 数据库文件路径。
- `PROJECT_CORS_ORIGINS`：允许直连 API 的前端来源，多个地址使用逗号分隔。
- `PROJECT_API_PROXY_SECRET`：前端代理与 Python API 之间共享的密钥；正式环境必须配置相同值。
- `PROJECT_ENV`：正式环境设置为 `production`，若缺少代理密钥，API 将拒绝请求。
- `PROJECT_MEMBERSHIP_MODE`：成员加入策略。正式环境默认 `invite_only`；仅明确设为 `open` 时允许已登录用户自动加入。
- `PROJECT_BOOTSTRAP_ADMIN_EMAIL`：正式环境首次初始化时允许成为系统管理员的唯一邮箱。

正式部署时可以保持 API 形状不变，将 SQLite 数据访问层替换为 PostgreSQL。
