# P0-PACKAGE-ISOLATION

Priority: P0
Scope: Imports across `packages/*`.

## Rule
- 包与包之间的调用必须通过 package name 与声明的 `exports` 入口完成。
- 不允许通过相对路径直接 import 兄弟 package 的源码文件。
- 所有跨包依赖都必须在消费方 `package.json` 中显式声明。

## Non-Goals
- 不禁止同一 package 内部的相对路径 import。
- 不限定具体构建工具或 alias 方案。

## Exceptions
- 无。

## Checks
- 发现通过路径穿越访问其他 package 源码时，评审直接驳回。
- 确认跨包依赖已出现在消费方 `package.json`。
- 内部依赖统一要求通过包名导入（例如 `@yuumi/<pkg>`）。
