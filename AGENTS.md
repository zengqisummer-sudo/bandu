# AGENTS.md — 开发者/Agent 上下文速览

> 需求见 REQUIREMENTS.md，完整技术规格见 SPEC.md（本文件只放"动手前必须知道的事"）。

## 是什么

纯前端 AI 伴读 Web 应用：epub 阅读器 + 随文注释（章节导读自动 / 选中深挖）+ 阅读对话 + 摘录。
无后端、BYOK（用户自己的 API key 浏览器直连模型服务）、数据落在用户本地文件系统。

## 命令

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build（提交前必须过）
```

技术栈：Vite + React 18 + TS(strict) + Tailwind v4 + zustand + epubjs（仅解析）+ marked/DOMPurify。
仅支持 Chromium（File System Access API、CSS Custom Highlight API）。

## 目录导航

```
src/services/storage/   存储抽象：fsa.ts（文件夹模式）/ idbStorage.ts（浏览器模式）/ paths.ts（全部逻辑路径）
src/services/epub/      import.ts 导入；parse.ts 章节解析缓存 + 资源 blob URL
src/services/anchor/    锚点创建/解析/模糊重定位（块序号 + 字符偏移 + 引文兜底）
src/services/ai/        client.ts 多提供商流式；context.ts 前文窗口（防剧透裁剪）；prompts.ts 默认 prompt
src/services/product/   markdown.ts 产物文件模板与追加写入
src/stores/             settings（boot/模式）/ library / reader（注释/摘录/进度）/ chat / ui
src/pages + components/ shelf（书架+向导）/ reader（正文）/ panel（右栏三 Tab）/ settings
```

## 不变式（改代码前先读）

1. **产物区（markdown）只能追加**：唯一写入口 `StorageProvider.appendMarkdown`，
   实现是 `createWritable({keepExistingData:true})` + 末尾定位写。任何"读出来改完整写回"的
   方案都会抹掉用户在 Obsidian 里的手动编辑，禁止。
2. **块编号决定锚点**：`anchor/anchor.ts:collectBlocks` 同时被"解析缓存"（paras 数组）与
   "渲染 DOM"（data-para 编号）使用，两侧必须走同一函数。改动它或 DOMPurify 配置会使旧锚点
   偏移（有引文模糊重定位兜底，但别依赖它）。
3. **防剧透在代码层**：`ai/context.ts:beforeWindow` 只取边界之前的文本。任何新的 AI 场景都
   必须通过它取上下文，不要直接拼全书文本。
4. **应用内渲染以状态区 JSON 为准**，不回读解析产物 markdown；删除注释只改 JSON，md 保留历史。
5. API key 只存 localStorage（`aireader.key.<provider>`），不得写入任何文件。
6. 章节缓存里的 html 保留 epub 内原始资源路径；blob URL 跨会话无效，渲染时由
   `parse.ts:resolveResources` 现场解析。

## 已知取舍

- 默认模型 `deepseek-v4-flash` 的 ID 字符串未经在线核实（编写时搜索服务不可用），设置中可改。
- Kindle/文本导入的摘录若非精确命中，锚点降级为整块（段落级）高亮。
- 正文内链/脚注跳转被去除（自绘阅读器无处可跳）。
- 不自动 commit；构建产物 base 为相对路径，可部署任意静态托管子路径。
