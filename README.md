# Yuumi

前后端联合模板：packages/web 固定引用 Preyou/ngt-starter，packages/server 固定引用 Preyou/yuumi-server。根只维护安装、环境和运行编排。

使用 Bun 1.4 或更新版本，安装前确保可访问 Preyou 私有仓库。本机 Bun 1.4.2 的干净安装验证使用环境变量 `GITHUB_TOKEN`（具备依赖仓库读取权限）；Token 仅通过进程环境提供，不写入仓库。Git 克隆使用已配置的 SSH。

```bash
git clone --recurse-submodules git@github.com:Preyou/yuumi.git
cd yuumi
bun run create -- ../my-app
cd ../my-app
bun install --frozen-lockfile
bun run setup
# 编辑 packages/server/.env.local，填写本项目的独立库名、Redis 逻辑库及凭据
bun run db:migrate
bun run dev
```

setup 只创建缺失的 packages/server/.env.local。配置自己的 Logto Traditional Web 应用与 API Resource，回调为 http://localhost:1282/api/auth/callback/logto。Server 环境示例的注释记录当前服务器地址，连接串、库名和密钥默认留空。先准备本项目独立数据库并填写配置，setup 不会覆盖已有 .env.local，也不会创建数据库。Web 固定 localhost:1282，Server localhost:3100，浏览器通过同源 /api 访问。

## 可选隔离开发环境

需要自建隔离实例时，先为每个新项目配置唯一的 `COMPOSE_PROJECT_NAME`，再运行 `bun run infra:up`；同机多项目还要分别选择 `POSTGRES_PORT` 和 `REDIS_PORT`，避免复用同一组容器或端口。自带 Compose 的 PostgreSQL 为 `127.0.0.1:25432`（用户名/库名 `yuumi`），Redis 为 `127.0.0.1:26379`。在 `packages/server/.env.local` 显式填写对应连接串；PostgreSQL 密码取自 compose.yaml 的开发配置，Redis 逻辑库由本项目选择，然后运行迁移。不要直接将当前服务器示例当成 Compose 的连接地址。

```bash
bun run check
bun run build
```

`create` 从联合模板的当前 Git 提交及其中固定的前后端提交展开源码，并初始化新 Git 仓库。工作区和暂存区的修改不会进入项目。需要 Git、Bun 与系统 `tar`。若子模块未初始化或提交不匹配，先运行 `git submodule update --init --recursive`。目标必须是新目录。

生成项目提交 `packages/web/env/.env` 和各仓库的 `bun.lock`。两端的 `.env.local` 用于本地配置。若只需运行模板本身，可在克隆目录直接执行冻结安装与 `setup`。

后端接口变化且服务端配置齐备时，运行 `bun run generate:web` 导出 OpenAPI 并生成前端类型。只使用随模板提供的 OpenAPI 快照时，运行 `bun run --cwd packages/web generate`。

- [设计](./docs/detailed-design/INDEX.md)
- [实施](./docs/implementation/INDEX.md)
