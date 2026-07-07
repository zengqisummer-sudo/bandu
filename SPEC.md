# SPEC — AI 伴读工具 技术规格

> 依据 REQUIREMENTS.md 编写。状态：**已确认**（2026-07-06，决策记录见 §7），按此实现。
> 本文档是实现的直接依据，需求层面的"为什么"见 REQUIREMENTS.md。

---

## 0. 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 构建 | Vite + React 18 + TypeScript | 静态构建产物，Vercel / GH Pages 直接托管 |
| 样式 | Tailwind CSS | 快速做出干净好看的阅读界面 |
| 状态 | zustand | 轻量，无模板代码 |
| epub 解析 | epubjs（**只用其解析层** Book/Spine/Archive，不用 Rendition 渲染） | 省掉 container/opf/toc/资源解压的工作量 |
| 正文渲染 | 自绘：章节 XHTML 经 DOMPurify 消毒后注入阅读区，滚动式排版 | epub.js 的 iframe 渲染难以做选中浮条、行内注释标记；自绘完全可控 |
| 面板 markdown | marked + DOMPurify | 注释/对话内容按 markdown 显示（复用 epub 消毒依赖，少一个包） |
| 路由 | hash 路由（`#/read/:id`） | 静态托管无需服务端 rewrite |
| AI | **多提供商**：DeepSeek（默认，OpenAI 兼容接口）/ Anthropic 原生 / 自定义 OpenAI 兼容端点，均为浏览器直连 + SSE 流式 | BYOK，无后端；用户指定默认用 DeepSeek |

无环境变量、无后端。API key 由用户在设置中填写，**按提供商分别只存 localStorage**（不写入任何文件夹，天然不进 Git；换浏览器需重填）。

---

## 1. 数据文件格式

### 1.1 总览

两个用户分别授权的目录（FileSystemDirectoryHandle 持久化在 IndexedDB，重启后按需重新请求权限）：

- **状态根**（库外）：JSON，机器可整写覆盖，应用是唯一写者。
- **产物根**（Obsidian 库内）：Markdown，**只允许追加，绝不整体覆盖**（用户可能已手动编辑）。

书籍 ID：`b-` + epub 文件 SHA-256 前 12 位十六进制，跨机器稳定。

### 1.2 状态根目录结构

```
状态根/
├─ settings.json               # 全局设置
├─ prompts.json                # 三类内容 × 三场景的 prompt
└─ books/
   └─ b-3f9a12ab34cd/
      ├─ book.epub             # 导入时复制进来的原始 epub（真相源，换浏览器不丢书）
      ├─ book.json             # 元数据
      ├─ progress.json         # 阅读位置
      ├─ annotations.json      # 注释索引（应用内渲染的数据源）
      ├─ conversations.json    # 对话会话
      ├─ excerpts.json         # 摘录索引
      └─ cache/
         └─ chapters/
            └─ 0002.json       # 章节解析缓存 { html, text }，按 spine 序号命名
```

所有 JSON 顶层带 `"version": 1` 以备迁移。

**settings.json**

```json
{
  "version": 1,
  "ai": {
    "provider": "deepseek",
    "deepseek":  { "model": "deepseek-v4-flash" },
    "anthropic": { "model": "claude-sonnet-5" },
    "custom":    { "baseUrl": "", "model": "" }
  },
  "contextChars": 6000,
  "chapterNoteMaxChars": 12000,
  "autoChapterNote": true,
  "reading": { "fontSize": 18, "lineHeight": 1.9, "maxWidth": 720, "theme": "light" }
}
```

模型 ID 是可编辑文本框（带预设列表），设置中提供"测试连接"。`deepseek-v4-flash` 这个字符串以 DeepSeek 官方文档为准，如不符在设置中改一下即可（不影响结构）。API key 不在此文件，按提供商存 localStorage（`aireader.key.deepseek` 等）。

**prompts.json**（应用内置默认值；此文件保存用户改动，缺字段回退默认）

```json
{
  "version": 1,
  "poetry":  { "chapter": "…", "passage": "…", "chat": "…" },
  "novel":   { "chapter": "…", "passage": "…", "chat": "…" },
  "social":  { "chapter": "…", "passage": "…", "chat": "…" }
}
```

**book.json**

```json
{
  "version": 1,
  "id": "b-3f9a12ab34cd",
  "title": "城堡",
  "author": "卡夫卡",
  "contentType": "novel",
  "epubHash": "3f9a12ab34cd…（完整 sha256）",
  "importedAt": "2026-07-06T08:00:00Z",
  "spineLength": 31,
  "toc": [ { "label": "第一章 到达", "spine": 2, "children": [] } ],
  "productDir": "城堡"
}
```

`contentType: "poetry" | "novel" | "social"`，决定使用哪组 prompt。`productDir` 是产物根下的子目录名（书名清洗后，重名加后缀）。

**progress.json**

```json
{
  "version": 1,
  "spine": 4,
  "anchor": { "para": 12, "offset": 0 },
  "percent": 0.31,
  "updatedAt": "2026-07-06T09:30:00Z"
}
```

阅读位置 = 视口顶部所在段落。它是防剧透边界与对话上下文边界（§4.3）。

**annotations.json**（章节导读也是一条注释，`kind: "chapter"`）

```json
{
  "version": 1,
  "items": [
    {
      "id": "a-8kf2…",
      "kind": "passage",
      "spine": 4,
      "anchor": { "para": 12, "start": 10, "end": 56, "quote": "他站在木桥上…", "prefix": "…雪地里。", "suffix": "随后他…" },
      "content": "（AI 生成的注释 markdown）",
      "createdAt": "2026-07-06T09:31:00Z"
    }
  ]
}
```

（md 路径固定为该书的 `注释.md`，不需字段记录。）

**conversations.json**

```json
{
  "version": 1,
  "sessions": [
    {
      "id": "s-x1…",
      "title": "叙事视角讨论",
      "createdAt": "2026-07-06T09:40:00Z",
      "context": { "spine": 4, "quote": "他站在木桥上…", "percent": 0.31 },
      "turns": [ { "role": "user", "content": "这段是谁在说话？", "t": "…" } ],
      "lastSavedTurn": 4
    }
  ],
  "lastWrittenSession": "s-x1…"
}
```

对话全文实时存这里；markdown **自动追加落盘**（每完成一次 AI 回复即写入该轮往返，见 §1.5-4）。`lastSavedTurn` 记录已写到 md 的轮数；`lastWrittenSession` 用于判断是否需要补"（续）"小节头（§1.4）。

**excerpts.json**

```json
{
  "version": 1,
  "items": [
    { "id": "e-…", "spine": 4, "anchor": { "…同注释锚点" }, "quote": "…", "note": "", "source": "kindle", "createdAt": "…" }
  ]
}
```

`source: "manual" | "kindle" | "text"`（manual = 选中浮条摘录；text = 通用文本粘贴导入）。导入中匹配不到原文的条目：`spine: -1, anchor: null`，进"未定位"列表，仍写入 md。

### 1.3 锚点格式

不使用 epub CFI（自绘 DOM 与原始结构有差异），用自定义锚点：

```json
{ "para": 12, "start": 10, "endPara": 12, "end": 56, "quote": "选中的原文", "prefix": "前 20 字", "suffix": "后 20 字" }
```

- `para`：章节渲染后块级元素序号（消毒器配置固定，输出稳定）；`start/end`：段内纯文本字符偏移；选中跨段时 `endPara > para`。
- 解析失败（如换了消毒器版本）时降级：用 `quote` + `prefix/suffix` 在本章文本内模糊搜索重定位；再失败标记"失锚"，注释仍在右栏显示，只是正文不高亮。

### 1.4 产物根目录结构（Obsidian 库内）

**一本书固定 3 个文件**（用户已确认）：

```
产物根/
└─ 城堡/
   ├─ 注释.md     # 全书注释（含章节导读），逐条追加
   ├─ 对话.md     # 全部对话，按会话分节，逐轮追加
   └─ 摘录.md     # 全部摘录，逐条追加
```

因写入只能追加（§1.5），文件内条目按**生成时间**排序（≈ 阅读顺序；跳章重读时会乱序，接受）。每个条目标题自带章节名，Obsidian 内可读可检索。

**注释.md**（首次写入时创建 frontmatter；此后逐条追加，条目间用 `---` 分隔；标题统一 H2 = 章节名 · 标识）：

```markdown
---
书名: 城堡
作者: 卡夫卡
类型: 阅读注释
来源: AI伴读
---

---

## 第一章 到达 · 章节导读
<!-- ai-anno {"id":"c-9d…","kind":"chapter","spine":4,"t":"2026-07-06T09:20:00Z"} -->

（章节级注释正文，markdown）

---

## 第一章 到达 · 「他站在木桥上…」
<!-- ai-anno {"id":"a-8kf2…","kind":"passage","spine":4,"para":12,"t":"2026-07-06T09:31:00Z"} -->

> 他站在木桥上，久久望着那似乎空洞的高处。

（段落注释正文）
```

HTML 注释行承载机器元数据（Obsidian 预览不可见）；条目标题取引文前 12 字。

**对话.md**（自动落盘，见 §1.5-4；一个会话 = 一个 H2 小节，轮次逐条追加）：

```markdown
---
书名: 城堡
类型: 阅读对话
来源: AI伴读
---

---

## 2026-07-06 · 叙事视角讨论
> 语境：读至第一章 31%，选中「他站在木桥上…」

**我**：这段是谁在说话？

**AI**：……

---

## 2026-07-06 · 官僚系统讨论
> 语境：读至第二章 42%

**我**：……
```

追加规则：写入某会话的新轮次时，若文件中最后写入的会话不是它（中间插了别的会话），先补一行 `## {标题}（续）` 小节头再追加轮次，保持可读。

**摘录.md**（逐条追加）：

```markdown
---
书名: 城堡
类型: 摘录
来源: AI伴读
---

---

> 他站在木桥上，久久望着那似乎空洞的高处。
<!-- ai-excerpt {"id":"e-…","spine":4,"t":"…"} -->

— 第一章 到达 · Kindle 导入
```

### 1.5 写入规则（关键约束）

1. **产物区唯一写入口** `appendMarkdown(path, block, frontmatterIfNew)`：
   - 文件不存在 → 创建，写 frontmatter + 首个块；
   - 存在 → `createWritable({ keepExistingData: true })`，从 `file.size` 位置写入 `"\n\n---\n\n" + block`，**不读改写任何既有字节**。用户在 Obsidian 里加的双链、批注绝不会被动到。
2. 状态区 JSON 用整写（写临时文件名再替换语义由 `createWritable` 默认行为保证：全部写完 close 才落盘）。
3. **应用内渲染注释/对话/摘录一律以状态区 JSON 为数据源**，不回读解析 markdown。用户在 Obsidian 里对 md 的编辑不会同步回应用——md 是面向知识库的只增记录流，JSON 是应用运行态。应用内删除一条注释只改 JSON，md 中的历史块保留（追加模式下无法安全删除）。
4. 对话写入时机：**自动**（用户确认，不存在闲聊污染问题）。每当一次 AI 回复流式完成，把该轮往返（我 + AI）追加到 对话.md；会话首轮先写会话小节头。流式中断/出错的轮次不写。
5. 已知限制（文档中注明即可）：用户若恰好在 Obsidian 中打开着该文件且有未保存编辑，同一时刻应用追加可能引起 Obsidian 冲突提示，属外部编辑器行为，不做处理。

### 1.6 IndexedDB 与降级模式

- 文件夹模式下 IndexedDB 只存：两个目录句柄、运行时缓存（可全清，文件是真相源）。
- **浏览器模式（降级，对外分享的默认）**：存储层换实现，同样的逻辑路径（§1.2/§1.4）映射为 IDB 的 `path → content` KV，包括 epub 与"虚拟 md"。用户后续切换到文件夹模式时，一次性把全部内容写出到文件系统。

存储抽象（两种模式的公共接口）：

```ts
interface StorageProvider {
  readJson<T>(area: "state" | "product", path: string): Promise<T | null>;
  writeJson(area: "state", path: string, data: unknown): Promise<void>;
  appendMarkdown(path: string, block: string, frontmatterIfNew?: string): Promise<void>;
  readBinary / writeBinary / exists / list;
}
```

类型系统上只允许对 state 区 writeJson，product 区只有 append 入口。

---

## 2. 页面结构

### 2.1 路由

| 路由 | 页面 |
|---|---|
| `#/` | 书架页（含首次运行向导） |
| `#/read/:bookId` | 阅读页 |

设置是全局弹层（Modal），不占路由。

### 2.2 首次运行向导（书架页内嵌）

1. 选模式：**文件夹模式**（推荐，Chrome/Edge）/ 浏览器模式（数据存浏览器内）。
2. 文件夹模式 → 依次授权 产物文件夹（提示指向 Obsidian 库内目录）、状态文件夹（库外），说明各自用途。
3. 填 API key（可跳过，首次调用 AI 时再索要）。
4. 引导导入第一本 epub。

刷新后目录权限失效时，顶部横幅提示"点击恢复文件夹访问"（需用户手势才能重新授权）。

### 2.3 书架页

- 书籍卡片网格：封面（epub 内提取）、书名、作者、进度条、内容类型标签（诗/小说/社科）。
- 导入按钮 + 拖拽导入；导入时选择内容类型。
- 卡片菜单：打开 / 修改内容类型 / 删除（删状态区该书目录；产物 md 一律保留）。

### 2.4 阅读页

```
┌──────────────────────────────────────────────────────────────┐
│ ← 书架   城堡 · 第一章 到达        31%   [目录] [Aa] [面板] [⚙]│
├─────────┬──────────────────────────────────┬─────────────────┤
│ 目录     │                                  │ 注释 | 对话 | 摘录│
│ (可收起) │        正文（本章滚动流）          │─────────────────│
│         │                                  │ ▧ 章节导读卡片    │
│  第一章 ▸│   被注释文字带下划虚线+角标点      │ ¶ 注释卡片        │
│  第二章  │                                  │ ¶ 注释卡片        │
│         │   选中文字 → 浮条：               │   （与正文双向联动）│
│         │   [深挖] [提问] [摘录]            │                  │
│         │                                  │                  │
│         │      ‹ 上一章    下一章 ›         │ （对话页：输入框） │
└─────────┴──────────────────────────────────┴─────────────────┘
```

交互清单：

- **章节打开**：加载该章 → 若 `autoChapterNote` 且本章无 `kind:chapter` 注释 → 自动生成，右栏顶部卡片流式显示。
- **选中浮条**：深挖 → 生成锚定注释（右栏流式显示，完成后正文加下划线标记并写 md）；提问 → 右栏切到对话页并新建会话，携带选中语境；摘录 → 存为摘录并追加 md。
- **双向联动**：点正文注释标记 → 右栏滚到对应卡片并高亮；点卡片 → 正文滚到锚点。
- **进度**：滚动节流保存 progress.json；`percent ≈ (spine + 章内比例) / spineLength`。
- **对话页**：会话列表（本书全部）+ 当前会话消息流 + 输入框；每轮回复完成后自动落盘 md（界面有落盘状态角标），会话可重命名（改 JSON 内标题；md 中已写小节头不动）。
- **[Aa]**：字号/行距/页宽/亮暗小弹层。
- 桌面优先，不做移动端适配（File System Access API 本身限桌面 Chrome/Edge）。

### 2.5 设置弹层

分区：**AI 提供商**（DeepSeek 默认 / Anthropic / 自定义 OpenAI 兼容端点；每个提供商各自的 API key 输入（遮显）+ 模型 ID 文本框（带预设 datalist）+ "测试连接"）｜文件夹（显示当前授权状态、更换、浏览器模式数据一键写出）｜Prompt 编辑器（3 内容类型 × 3 场景的 textarea，每格带"恢复默认"）｜上下文长度。

模型预设：DeepSeek → `deepseek-v4-flash`（默认）、`deepseek-chat`、`deepseek-reasoner`；Anthropic → `claude-sonnet-5`、`claude-fable-5`、`claude-opus-4-8`、`claude-haiku-4-5-20251001`。

---

## 3. 组件划分

### 3.1 源码结构

```
src/
├─ main.tsx / App.tsx            # 引导 init、路由分发、设置弹层与 Toast 挂载
├─ lib/                          # router(hash路由) / idb(极简封装) / utils
├─ pages/
│  ├─ ShelfPage.tsx              # 含向导/恢复访问的分发
│  └─ ReaderPage.tsx             # 打开/关闭书籍生命周期 + 三栏布局
├─ components/
│  ├─ shelf/    BookCard, ContentTypeDialog(导入选类型), FirstRunWizard, RestoreAccess
│  ├─ reader/   ReaderHeader(含 Aa 偏好弹层), TocSidebar,
│  │            ChapterView(正文注入/块编号/高亮角标/选中浮条/进度上报/章节导航)
│  ├─ panel/    SidePanel(Tab容器), AnnotationsTab(导读卡+注释卡), ChatTab(会话+消息流+输入),
│  │            ExcerptsTab(含 ImportExcerptsDialog：Kindle txt / 通用文本粘贴)
│  ├─ settings/ SettingsModal（AI提供商/存储/Prompt编辑/上下文 四区）
│  └─ common/   Markdown(marked+DOMPurify), Modal, Toasts
├─ stores/
│  ├─ settingsStore.ts           # boot 状态机(wizard/fs-restore/ready)、settings/prompts、模式切换与迁移
│  ├─ libraryStore.ts            # 书籍列表、封面、导入/删除
│  ├─ readerStore.ts             # 当前书：章节、progress、annotations/excerpts、注释生成编排
│  ├─ chatStore.ts               # 会话、流式、自动落盘编排
│  └─ uiStore.ts                 # Toast、设置弹层、右栏开合与当前 Tab
├─ services/
│  ├─ storage/  provider.ts(接口) fsa.ts idbStorage.ts index.ts(模式/迁移) handles.ts paths.ts
│  ├─ epub/     import.ts(hash→复制→元数据/目录/封面) parse.ts(实例池/章节解析缓存/资源blob解析)
│  ├─ anchor/   anchor.ts        # collectBlocks / createAnchorFromRange / resolveAnchor(三级降级)
│  ├─ ai/       client.ts(多提供商SSE) context.ts(防剧透窗口,§4.3) prompts.ts(默认prompt+组装)
│  ├─ product/  markdown.ts      # 三类 md 模板 + appendMarkdown 调用
│  └─ import/   kindle.ts        # My Clippings 解析 / 通用文本分条 / 引文回原文定位
└─ types/                        # §1.2 各 schema 的 TS 类型 + FSA 补充声明
```

### 3.2 关键组件职责

- **ChapterView**：唯一接触正文 DOM 的组件。渲染消毒后 HTML；挂载后为块级元素编号（锚点用）；监听 selection 事件驱动 SelectionPopover；根据 annotations 渲染 AnnotationMark（Range → 下划线 span 包裹）；滚动上报进度。
- **SelectionPopover**：浮于选区上方，三按钮，点击后携带 `{anchor, quote}` 调用对应 store action。
- **SidePanel**：三 Tab；接收"聚焦某注释/新建会话"等指令（由 popover/正文点击触发）。
- **StreamingText**：SSE 增量渲染 markdown，注释生成与对话回复共用。
- **stores 与 services 的边界**：组件只调 store action；store action 编排 services（生成注释 = context 组装 → ai.client 流式 → 写 annotations.json → product/markdown 追加）。

---

## 4. AI 调用与上下文

### 4.1 请求

统一抽象 `streamChat({provider, model, key, system, messages, maxTokens, signal}): AsyncGenerator<string>`，两种协议实现：

- **OpenAI 兼容**（DeepSeek / 自定义端点）：`POST {baseUrl}/chat/completions`（DeepSeek baseUrl = `https://api.deepseek.com`），header `Authorization: Bearer {key}`，body `{ model, messages（system 作首条）, stream: true, max_tokens }`，SSE 增量取 `choices[0].delta.content`。
- **Anthropic 原生**：`POST https://api.anthropic.com/v1/messages`，headers `x-api-key`、`anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true`（浏览器直连 CORS 必需），SSE 增量取 `content_block_delta`。

全部流式。`max_tokens`：注释 1024 / 对话 2048。错误处理：401 → 引导检查 key；404/400 含 model 字样 → 提示核对模型 ID；429/5xx → 提示稍后重试。DeepSeek 浏览器直连 CORS 需在联调时验证（业界 BYOK 工具普遍直连，预期可行）。

### 4.2 Prompt 组装

`system` = 通用底座（角色 + 防剧透铁律 + 输出为中文 markdown、不用标题层级过深）+ `prompts.json[contentType][场景]`。
`user` = 书籍信息（书名/作者/类型）+ 前文窗口 + 现场材料（本章至锚点文本 / 选中引文 / 对话历史）+ 场景指令。

### 4.3 上下文窗口与防剧透边界

| 场景 | 携带上下文 | 硬边界（此后文本绝不发送） |
|---|---|---|
| 章节导读 | 前文最后 `contextChars` 字 + 已读章节标题列表 + 本章全文（截断至 `chapterNoteMaxChars`） | 本章末尾；prompt 同时要求不透露本章内关键转折 |
| 段落深挖 | 锚点前 `contextChars` 字（可跨章向前取） | 选区末尾 |
| 对话 | 当前阅读位置前 `contextChars` 字 + 会话历史（超长丢最早轮） + 发起时的选中引文 | 当前阅读位置 |

边界在**代码层**裁剪（不只靠 prompt 约束），prompt 中再声明一次防剧透规则，双保险。

---

## 5. 工程约定

- 无硬编码路径；clone → `npm i` → `npm run dev` 即用；`npm run build` 产物可直接静态托管。
- API key 只在 localStorage，仓库含 `.gitignore`（node_modules、dist、本地杂项）；不自动 commit。
- 仓库维护 SPEC.md（本文件，随实现更新）与 AGENTS.md（编码开始时创建：技术栈速览、目录导航、开发命令、修改注意点）。

## 6. 实施里程碑

| # | 内容 | 可验证结果 |
|---|---|---|
| M1 | 脚手架 + 书架 + epub 导入 + 阅读器（无 AI、IDB 暂存） | 能导入并流畅阅读一本 epub，进度记忆 |
| M2 | FSA 双文件夹模式 + 状态区 JSON 持久化 + 首次向导 | 清浏览器缓存后书与进度不丢 |
| M3 | 注释通道：章节导读自动生成 + 选中深挖 + md 追加写入 | Obsidian 中可见注释文件，手动编辑后继续生成不被覆盖 |
| M4 | 对话通道：会话、流式、自动落盘（逐轮追加） | 完整对话往返 + md 自动落盘 |
| M5 | 摘录：选中摘录 + Kindle My Clippings 导入 + 通用文本粘贴导入 | 三种来源均可定位并落盘 |
| M6 | 降级模式收尾 + Prompt 编辑器 + 视觉打磨 + 部署 | 线上可用链接 |

## 7. 决策记录（2026-07-06 用户确认）

1. **API key 只存 localStorage**，不写入状态文件夹。✔ 确认
2. **产物组织：一本书固定 3 个文件**（注释.md / 对话.md / 摘录.md），不按章/按会话拆分。✔ 用户修改后确认
3. **对话自动落盘**：每轮回复完成即追加写入，无手动按钮。✔ 用户修改后确认
4. **选中浮条含"摘录"操作**；摘录来源共三种：选中摘录、Kindle My Clippings 导入、通用文本粘贴导入。✔ 用户修改后确认
5. **默认提供商 DeepSeek，默认模型 `deepseek-v4-flash`**（ID 字符串以 DeepSeek 官方文档为准，设置中可改）；架构改为多提供商（DeepSeek / Anthropic / 自定义 OpenAI 兼容）。✔ 用户修改后确认
6. **md 是只增记录**：应用内删除注释只从界面/JSON 移除，md 中历史块保留。✔ 确认
