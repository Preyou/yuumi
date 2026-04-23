# P0-CHANGE-VALIDATION

Priority: P0
Scope: All code changes in root and `packages/*`.

## Rule
- 先做最小影响范围验证，再按需要扩展验证范围。
- 仅变更单个 package 时，执行该 package 的有效检查。
- 变更共享配置/工具或同时影响多个 package 时，执行跨包验证。
- 发现“过时数据/过时生成物”时，允许优先复用仓库已有脚本进行更新，不要求手工修改。
- 验证阶段必须检查是否引入“过度兜底/吞错继续执行”；若发现，按 Fail-Fast 原则改为显式失败并暴露根因。
- 未记录验证结果（工作记录、PR 或提交上下文）前，变更不视为完成。

## Non-Goals
- 不要求所有 package 共享同一条万能命令。
- 不强制执行仓库中不存在的脚本。

## Exceptions
- 紧急线上 hotfix 可临时降级检查，但必须补充后续完整验证任务。

## Checks
- 当前仓库建议的 package 级检查：
  - `@yuumi/web`: `bun run --filter @yuumi/web type-check`
  - `@yuumi/server`: 执行能反映改动行为的包内验证（测试或针对性运行时 smoke check）。
- 发现数据或生成物过时时，检查是否优先使用仓库已有脚本完成更新。
- 抽查改动中的错误处理分支，确认未通过静默降级、默认成功返回或宽泛兜底掩盖真实错误。
- 触及共享契约/配置时建议的跨包检查：
  - `bun run --filter @yuumi/web type-check`
  - 以及与受影响 API 行为对应的 server 验证。
