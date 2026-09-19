# 贡献指南

感谢你对 FlowPilot 的关注。当前项目处于 alpha 阶段，欢迎提交缺陷修复、测试、文档和边界清晰的小型功能。

## 开始之前

1. 搜索现有 Issue，避免重复工作。
2. 较大的功能或数据模型改动，请先创建讨论 Issue，说明用户场景、范围和迁移方案。
3. 安全问题不要公开披露，请遵循 [SECURITY.md](./SECURITY.md)。

## 本地开发

```bash
npm install
npm run setup:api
cp .env.example .env.local
npm run dev
```

不要在测试或截图中使用真实客户数据、员工信息和第三方凭证。

## 提交前检查

```bash
npm run test:api
npm run lint
npx tsc --noEmit
npm run build
```

新增后端行为应补充 `tests/test_backend.py`；新增交互应覆盖正常、空状态、无权限和失败场景。

## Pull Request

- 一次 PR 聚焦一个主题，说明动机、实现和验证方式。
- 涉及 UI 时附上截图或短视频。
- 涉及 Schema 或 API 时说明兼容性、数据迁移和回滚方式。
- 不要提交生成文件、本地数据库、上传材料、`.env` 或密钥。
- 保留用户已有数据，不在迁移或脚本中执行未经说明的破坏性操作。

## 代码约定

- TypeScript 保持类型明确，避免用 `any` 绕过边界。
- Python API 的输入必须验证，写操作必须经过身份与权限检查。
- 日期时间统一明确时区；项目默认业务时区为 `Asia/Shanghai`。
- 第三方连接器必须支持幂等、可重试、审计和沙箱模式。
- AI 输出必须标注来源和不确定性，关键计划调整应由人确认。
