# P0-MONOREPO-BOUNDARY

Priority: P0
Scope: Repository root and `packages/*`.

## Rule
- 业务实现必须位于 `packages/*` 下。
- 仓库根目录仅承载编排与基础设施（workspace 配置、共享工具配置、CI、入口装配）。
- 新业务模块必须落在 package 内，不在根目录新增业务功能目录。

## Non-Goals
- 不禁止轻量的根目录 bootstrap 文件。
- 不规定具体 package 命名风格。

## Exceptions
- 新增业务逻辑无例外。
- 历史遗留在根目录的业务逻辑采用增量迁移，不要求一次性重写。

## Checks
- 对新增功能 diff，确认业务文件均位于 `packages/*`。
- 若在根目录新增领域业务目录，评审直接驳回。
