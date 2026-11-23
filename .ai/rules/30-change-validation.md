# 验证

文档先于代码；只格式化变更文件：`bunx --bun eslint <文件路径...> --fix`。提交前 `bun run docs:check`、`bun run check`、`bun run build`。编排修改需要验证全新目录 setup、生成流程及 create 展开结果；失败必须非零且不覆盖已有目录或配置。
