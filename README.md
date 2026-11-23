# Yuumi

前后端联合模板：packages/web 固定引用 Preyou/ngt-starter，packages/server 固定引用 Preyou/yuumi-server。根只维护安装、环境和运行编排。

安装前确保可访问 Preyou 私有仓库。本机 Bun 1.4.2 的干净安装验证使用环境变量 `GITHUB_TOKEN`（具备依赖仓库读取权限）；Token 仅通过进程环境提供，不写入仓库。Git 克隆使用已配置的 SSH。

```bash
git clone --recurse-submodules git@github.com:Preyou/yuumi.git
cd yuumi
bun install
bun run setup
bun run infra:up
bun run db:migrate
bun run dev
```

setup 只创建缺失的 packages/server/.env.local。配置自己的 Logto Traditional Web 应用与 API Resource，回调为 http://localhost:1282/api/auth/callback/logto。开发 PostgreSQL/Redis 的默认值只供本地使用。Web 固定 localhost:1282，Server localhost:3100，浏览器通过同源 /api 访问。

```bash
bun run generate:web
bun run check
bun run build
bun run create -- ../my-app
```

create 将两个模板的受版本控制源码展开到一个全新项目，并初始化新 Git 仓库；不复制 .git、真实环境配置、依赖目录或构建产物，不覆盖已存在目录。创建后在新项目运行 bun install 和 bun run setup。

- [设计](./docs/detailed-design/INDEX.md)
- [实施](./docs/implementation/INDEX.md)
