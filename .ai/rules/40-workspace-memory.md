# P1-WORKSPACE-MEMORY

Priority: P1
Scope: Repository root workdir and task workflows under root and `packages/*`.

## Rule
- AI 可以在工作目录根下创建并使用 `.memory/` 目录，作为仅供 AI 自主管理的中间记忆区。
- `.memory/` 用于保存可能因上下文压缩而丢失的重要中间信息，例如任务状态、关键决策、调查结论、临时计划、交接说明与复用线索。
- AI 必须基于当前会话唯一标识创建专属记忆文件，并且只对该文件拥有完全控制权。
- 在 Codex Desktop 环境中，当前会话唯一标识默认使用 `CODEX_THREAD_ID`；会话专属文件路径约定为 `.memory/<thread-id>.md`。
- AI 可以不经询问地创建、修改或删除自己的会话专属记忆文件，以维持当前任务连续性，但文件名应保持为 `.memory/<thread-id>.md`。
- `.memory/` 中其他记忆文件可能由并行 AI 会话创建；AI 可以读取这些文件，但不得修改、重命名或删除它们。
- `.memory/` 不是产品源码、正式文档或用户交付物的事实来源；当信息变成长期规范或用户要求产出时，应转移到合适的受版本控制文件。
- `.memory/` 必须保持位于工作目录根下，不在子 package 内重复创建同名目录。
- `.memory/` 必须保持 Git 忽略状态，避免 AI 中间记忆进入版本库。
- 具体使用约定见仓库根目录下的 `skills/workspace-memory/SKILL.md`。

## Non-Goals
- 不要求每个任务都必须写入 `.memory/`。
- 不允许借由 `.memory/` 绕过正常的代码解释、验证与交付流程。
- 不要求把已有源码、配置或文档镜像复制到 `.memory/`。
- 不提供跨会话共享可写记忆文件。

## Exceptions
- 若用户明确要求某类信息不要落盘，则不得写入 `.memory/`。
- 若任务自身指定了其他记忆位置或格式，优先遵循用户指示。

## Checks
- 根目录 `.gitignore` 包含 `.memory/`。
- 不新增任何受版本控制的 `.memory/*` 文件。
- 检查写入、删除操作是否仅作用于当前会话专属记忆文件。
- 检查当前会话专属记忆文件名是否保持为 `.memory/<thread-id>.md`。
- 检查其他 `.memory/*` 文件是否保持只读引用，不被当前会话修改。
- 当任务跨度较大或关键上下文有丢失风险时，检查是否应先把高价值信息整理进 `.memory/`。
