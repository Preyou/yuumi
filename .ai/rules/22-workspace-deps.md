# P0-WORKSPACE-DEPS

Priority: P0
Scope: `packages/*/package.json` and root `package.json`.

## Rule
- 内部 package 依赖必须使用 `workspace protocol`。
- 在未定义更严格策略前，内部引用默认使用 `workspace:*`。
- 不允许为内部依赖使用随意的 semver 范围。

## Non-Goals
- 不影响外部第三方依赖写法。
- 不要求一次性清理未触及文件中的历史遗留项。

## Exceptions
- 若某 package 需要发布并验证固定内部版本，可在写明原因后进行版本钉住（pinning）。

## Checks
- 对变更过的 manifest，检查所有 `@yuumi/*` 内部引用均使用 `workspace protocol`。
- 若新增内部依赖使用非 workspace 版本范围，评审直接驳回。
