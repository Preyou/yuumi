# P1-AI-WORKSPACE-INDEPENDENCE

Priority: P1
Scope: Repository root `.ai/**`, `packages/server/.ai/**`, `packages/web/.ai/**`, root `skills/**`

## Rule
- `packages/server` 与 `packages/web` 视为可独立运行、可独立托管的工作区。
- 为任一工作区编写规则或技能时，不得把另一个工作区的规则、技能或根目录共享 AI 资产作为必需依赖。
- `packages/server/.ai/**` 与 `packages/web/.ai/**` 应各自保持自洽；如果两边都需要同一能力，应分别在各自工作区内维护一份。
- 根目录 `skills/**` 仅服务于仓库根目录级任务，不作为 package 级 `.ai` 的必需引用目标。
- 允许规则描述运行时接口、共享协议或仓库事实，但不允许通过跨工作区 AI 文件引用来承载执行说明。

## Non-Goals
- 不禁止前后端在业务代码层共享协议事实或运行时契约。
- 不要求立刻消除所有非 AI 资产层面的仓库结构耦合。

## Exceptions
- 无。

## Checks
- 检查 `packages/server/.ai/**` 中是否引用 `packages/web/.ai/**` 或根目录 `skills/**`。
- 检查 `packages/web/.ai/**` 中是否引用 `packages/server/.ai/**` 或根目录 `skills/**`。
- 若两个工作区需要同一技能，检查是否各自在本地维护对应副本，而不是跨目录引用。
