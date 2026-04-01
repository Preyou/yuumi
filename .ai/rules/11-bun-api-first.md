# P0-BUN-API-FIRST

Priority: P0
Scope: Runtime application code, scripts, utilities under root and `packages/*`.

## Rule
- 在实现运行时能力与工具脚本时，优先使用 Bun native APIs。
- 文件访问、IO、进程执行、HTTP server 等能力优先走 Bun 原生方案。
- 除非 Bun 原生路径不可行，否则不要引入 Node-only APIs（如 `node:fs`、`node:http`、`node:child_process`）。
- 可行时优先采用 Bun 原语（如 `Bun.file`、`Bun.write`、`Bun.serve`、`Bun.$`）。

## Non-Goals
- 不强制为“纯技术一致性”重写稳定且无收益的存量代码。
- 不要求替换第三方库内部实现。

## Exceptions
- 当上游库/工具明确依赖 Node API 且没有可行 Bun 路径时，可例外使用。
- 例外必须在使用点附近写明简短原因。

## Checks
- 对源码执行 Node builtin 静态扫描：
  - `rg -n "from ['\\\"]node:|require\\(['\\\"]node:" packages index.ts`
- 评审时要求每个允许的 Node API 例外都有 inline 注释说明。
