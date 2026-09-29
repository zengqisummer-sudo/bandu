# AGENTS.md — 开发者/Agent 上下文速览

> 需求见 REQUIREMENTS.md，完整技术规格见 SPEC.md（本文件只放"动手前必须知道的事"）。

## 是什么

纯前端 AI 伴读 Web 应用：epub 阅读器 + 随文注释（章节导读自动 / 选中深挖）+ 阅读对话 + 摘录（手动标签 / 导出分享图）。
无后端、BYOK（用户自己的 API key 浏览器直连模型服务）、数据落在用户本地文件系统。

## 命令

```bash
npm install
npm run dev      # Vite dev server（开发/验证用，任意端口，但绝不要占 5180）
npm run build    # tsc -b && vite build（提交前必须过；也是"发版到用户本地稳定环境"的动作）
```

**本地双环境约定**：`http://localhost:5180` 是用户的日常阅读源——文件夹授权、API key、
书架数据都绑在这个 origin 上，`启动伴读.cmd`（桌面「伴读」快捷方式）在 5180 上 `vite preview`
服务 `dist/` 稳定构建。开发迭代不影响它；功能验证通过后跑 `npm run build` 用户才会拿到新版。
换端口 = 换 origin = 用户配置"消失"，所以 5180 永远留给用户。
（桌面快捷方式指向 cmd.exe 而非 .cmd 本身：Smart App Control 会静默拦截双击的未签名脚本。）

技术栈：Vite + React 18 + TS(strict) + Tailwind v4 + zustand + epubjs（仅解析）+ marked/DOMPurify + html-to-image（摘录出图）。
仅支持 Chromium（File System Access API、CSS Custom Highlight API）。

## 目录导航

```
src/services/storage/   存储抽象：fsa.ts（文件夹模式）/ idbStorage.ts（浏览器模式）/ paths.ts（全部逻辑路径）
src/services/epub/      import.ts 导入；parse.ts 章节解析缓存 + 资源 blob URL
src/services/anchor/    锚点创建/解析/模糊重定位（块序号 + 字符偏移 + 引文兜底；服务于深挖/摘录）
src/services/hints/     随文注释子系统（ANNOTATION_SPEC.md）：match.ts 匹配管线 / inject.ts DOM 注入 / parse.ts AI 输出解析
src/services/ai/        client.ts 多提供商流式；context.ts 前文窗口（防剧透裁剪）；prompts.ts 默认 prompt + hints 输出契约
src/services/product/   markdown.ts 产物文件模板与追加写入（含 hints 的 callout+脚注存档、摘录标签行定点改写）
src/lib/tags.ts         摘录标签：Obsidian 语法校验/归一化、标签行格式、全局标签词表（localStorage 联想）
src/stores/             settings（boot/模式）/ library / reader（注释/hints/摘录/进度）/ chat / ui
src/pages + components/ shelf（书架+向导）/ reader（正文）/ panel（右栏三 Tab；ExcerptImageModal 摘录出图 / TagInput 标签输入）/ settings
```

## 不变式（改代码前先读）

1. **产物区（markdown）常规只能追加**：常规写入口 `StorageProvider.appendMarkdown`，
   实现是 `createWritable({keepExistingData:true})` + 末尾定位写。唯一例外
   `rewriteMarkdown`：摘录标签行的定点改写（写入前一刻重读全文 → 只增/换/删
   ai-excerpt 元数据行紧邻的那一行标签 → 整写回），除此之外任何"读出来改完整写回"的
   方案都会抹掉用户在 Obsidian 里的手动编辑，禁止。新场景想用 rewriteMarkdown 必须先想清楚。
2. **块编号决定锚点**：`anchor/anchor.ts:collectBlocks` 同时被"解析缓存"（paras 数组）与
   "渲染 DOM"（data-para 编号）使用，两侧必须走同一函数。改动它或 DOMPurify 配置会使旧锚点
   偏移（有引文模糊重定位兜底，但别依赖它）。
3. **防剧透在代码层**：`ai/context.ts:beforeWindow` 只取边界之前的文本。任何新的 AI 场景都
   必须通过它取上下文，不要直接拼全书文本。
4. **应用内渲染以状态区 JSON 为准**，不回读解析产物 markdown；删除注释只改 JSON，md 保留历史。
   摘录标签同理：JSON 是准绳，md 标签行是同步副本（找不到目标条目就静默放弃）。
5. API key 只存 localStorage（`aireader.key.<provider>`），不得写入任何文件；
   摘录标签词表也在 localStorage（`aireader.tags.v1`），仅供输入联想，丢了无害。
6. 章节缓存里的 html 保留 epub 内原始资源路径；blob URL 跨会话无效，渲染时由
   `parse.ts:resolveResources` 现场解析。
7. **随文注释锚定只走 `@apache-annotator/dom`**（W3C TextQuoteSelector）：任何场合禁止对
   HTML/正文字符串做 `replace` 式注入；未匹配的 hint 必须进面板兜底列表并计入匹配率，
   绝不静默丢弃（ANNOTATION_SPEC §5.1/§6）。
8. **ChapterView 注入时序**：innerHTML → `numberBlocks` 编号 → hints 注入（`hintPass` 递增）
   → 旧式高亮/角标注册（挂在 hintPass 上）。注入后绝不重跑 `numberBlocks`；注入的
   callout/mark 元素不带 `data-para`，否则块编号漂移、旧锚点全部失效。
9. 正文源（epub 与章节缓存的 html）只读；hints 只在渲染时合并进 DOM，磁盘上永远与正文分离。
10. **摘录出图模板不吃应用主题**：ExcerptImageModal 的模板配色/字体全部写死，
    不引用 --paper/--ink 等主题变量，保证亮暗主题下导出结果一致。

## 已知取舍

- 默认模型 `deepseek-v4-flash` 的 ID 字符串未经在线核实（编写时搜索服务不可用），设置中可改。
- `@apache-annotator/dom@0.2.0` 的 css 模块依赖 `optimal-select`，后者 `module` 字段指向未发布的
  `src/`——vite.config.ts 里 alias 到其 CJS 入口 `optimal-select/lib/index.js` 才能构建。
  本应用不用其 CSS selector 功能，只用 TextQuoteSelector 匹配与 `highlightText`。
- 随文注释的匹配率取决于模型抄写锚点的忠实度；空白/引号级出入由归一化回退兜住，
  更大的出入进面板"未锚定"列表（数据不丢，可重新生成）。
- Kindle/文本导入的摘录若非精确命中，锚点降级为整块（段落级）高亮。
- 正文内链/脚注跳转被去除（自绘阅读器无处可跳）。
- 摘录标签后补时经 rewriteMarkdown 同步进 摘录.md（标签行紧跟摘录块）；与 Obsidian
  并发编辑同一文件存在毫秒级覆盖窗口，属已接受风险。
- 摘录出图用 html-to-image（DOM → PNG，pixelRatio 2）；字体依赖用户系统字体
  （Noto Serif SC/楷体栈有回退），无网络字体嵌入。
- 不自动 commit；构建产物 base 为相对路径，可部署任意静态托管子路径。

## 沙盒挂载的已知假错（务必先读）

在 Cowork/沙盒挂载中读取「最近在本机编辑过的源文件」时，挂载可能返回**被截断的旧快照**
（文件停在半行、无结尾换行），导致 `tsc -b` / `vite build` 在你**并未改动**的文件里报出
`TS17008 no corresponding closing tag`、`TS1002 unterminated string`、`TS1160/TS1005 '}' expected`
之类的错误。这类报错是**挂载视图过期**造成的假错，不是代码问题。

判别与应对：
- 真文件是否完整，以本机构建为准。`启动伴读.cmd` / 真实终端里的 `npm run build` 能通过即代表源码没问题
  （注意 `启动伴读.cmd` 构建失败会静默回退到旧 `dist/`，别只看「浏览器能打开」）。
- **绝对不要**在沙盒里「修复」这些看起来被截断的源文件——那会把截断视图写回，覆盖磁盘上完整的真文件。
- 需要在沙盒里构建时，先在 Cowork 里**断开并重新连接该文件夹**（或重启会话）刷新挂载，假错即消失。
- 安全的判据：对文件 `tail -c1` 若不是换行符(`0a`)，基本就是被截断的快照，此时该文件的一切写回都要避免。

## 伴读 2.0
以 docs/REQUIREMENTS.md、docs/SPEC.md 和 docs/DECISIONS.md 为最新增量依据。注释与想法独立；取消深挖入口。章节导读可读取本章并总结结论；全书导读仅书籍信息联网。用户要求不新建测试集，完成必要静态检查和构建后交用户验收。

想法话题与摘录标签分离：Annotation/ChatSession.topics + aireader.topics.v1；旧想法 tags 仅兼容读，不共享标签词库。IdeasTab 默认本书卡片，跨书卡片仅用于话题/链接搜索与主动展开。
