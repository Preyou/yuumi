# Yuumi

前后端联合模板：packages/web 固定引用 Preyou/ngt-starter，packages/server 固定引用 Preyou/yuumi-server。根只维护安装、环境和运行编排。

安装前确保可访问 Preyou 私有仓库。本机 Bun 1.4.2 的干净安装验证使用环境变量 `GITHUB_TOKEN`（具备依赖仓库读取权限）；Token 仅通过进程环境提供，不写入仓库。Git 克隆使用已配置的 SSH。

```bash
git clone --recurse-submodules git@github.com:Preyou/yuumi.git
cd yuumi
bun install
bun run setup
# 编辑 packages/server/.env.local，填写本项目的独立库名、Redis 逻辑库及凭据
bun run db:migrate
bun run dev
```

setup 只创建缺失的 packages/server/.env.local。配置自己的 Logto Traditional Web 应用与 API Resource，回调为 http://localhost:1282/api/auth/callback/logto。Server 环境示例的注释记录当前服务器地址，连接串、库名和密钥默认留空。先准备本项目独立数据库并填写配置，setup 不会覆盖已有 .env.local，也不会创建数据库。Web 固定 localhost:1282，Server localhost:3100，浏览器通过同源 /api 访问。

## 可选隔离开发环境

需要自建隔离实例时，先为每个新项目配置唯一的 `COMPOSE_PROJECT_NAME`，再运行 `bun run infra:up`；同机多项目还要分别选择 `POSTGRES_PORT` 和 `REDIS_PORT`，避免复用同一组容器或端口。自带 Compose 的 PostgreSQL 为 `127.0.0.1:25432`（用户名/库名 `yuumi`），Redis 为 `127.0.0.1:26379`。在 `packages/server/.env.local` 显式填写对应连接串；PostgreSQL 密码取自 compose.yaml 的开发配置，Redis 逻辑库由本项目选择，然后运行迁移。不要直接将当前服务器示例当成 Compose 的连接地址。

```bash
bun run generate:web
bun run check
bun run build
bun run create -- ../my-app
```

create 将两个模板的受版本控制源码展开到一个全新项目，并初始化新 Git 仓库；不复制 .git、真实环境配置、依赖目录或构建产物，不覆盖已存在目录。创建后在新项目运行 bun install 和 bun run setup。

- [设计](./docs/detailed-design/INDEX.md)
- [实施](./docs/implementation/INDEX.md)
