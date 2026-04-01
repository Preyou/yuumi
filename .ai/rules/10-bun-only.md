# P0-BUN-ONLY

Priority: P0
Scope: Root `package.json`, `packages/*/package.json`, CI scripts, local scripts.

## Rule
- 本仓库仅使用 Bun 作为 package manager 与 runtime。
- 文档与脚本统一使用 `bun`、`bun run`、`bunx`、`bun test`。
- 不将 `npm`、`pnpm`、`yarn` 作为受支持的主路径。
- 不将 `node <script>` 作为项目脚本的主执行方式。

## Non-Goals
- 不禁止使用同时支持 Node 的生态包。
- 不禁止依赖树中包含 Node tooling 的传递依赖。

## Exceptions
- 仅当 Bun 无法运行目标工具时，允许一次性迁移命令。
- 每个例外都必须附带简短原因与移除计划。

## Checks
- 扫描脚本和文档中的禁用命令：
  - `rg -n "\\b(npm|pnpm|yarn)\\b" package.json packages .ai README.md`
  - `rg -n "\\bnode\\s+" package.json packages .ai README.md`
- 代码评审中一旦出现禁用命令，要求改为 Bun 命令后再合入。
