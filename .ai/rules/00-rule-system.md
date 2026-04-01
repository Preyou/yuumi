# RULE-SYSTEM

Priority: P0
Scope: `.ai/rules/*`

## Rule
- 所有规则文件必须使用统一结构：`Priority`、`Scope`、`Rule`、`Non-Goals`、`Exceptions`、`Checks`。
- 规则冲突按优先级处理：`P0 > P1 > P2`。
- 同优先级规则冲突时，优先采用 `Scope` 更窄的规则。
- 任何例外都必须记录在变更 diff 或 PR description 中。

## Non-Goals
- 本文件不定义具体编码风格细节。
- 本文件不定义业务行为本身。

## Exceptions
- 无。

## Checks
- 评审新增规则文件时，确认必需章节完整存在。
- 对只有口号、没有可验证检查项的规则，直接拒绝合入。
