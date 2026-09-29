> 2026-09-28：2.0 已确认变更优先以 docs/REQUIREMENTS.md、docs/SPEC.md 为准；下文保留历史背景。

# 注释系统技术规格（ANNOTATION_SPEC）

> 本文档定义"随文注释"的**数据格式**与**渲染行为**，作为实现依据。
> 核心原则：正文与注释**在磁盘上永远是两个独立文件**；注释只在**渲染时**被合并进正文 DOM。禁止把注释烘焙进正文文件，禁止修改源正文。

---

## 1. 架构：分离存储 + 渲染时合并

- 正文（epub 的 xhtml，或转换后的 markdown/html）**只读**，工具永不写入。
- 注释单独存为 JSON（每章一个文件，或每书一个文件，见 §4）。
- 展示某章时，渲染器同时读取【正文】+【该章注释 JSON】，把每条注释按锚点注入正文 DOM 的对应位置。
- 好处：注释可随时重新生成 / 开关 / 按类型过滤；正文永不被污染；重新生成注释只替换 JSON，无合并冲突。

**"注释和章节分开显示"是错误的最终形态，只能作为兜底（§6）。默认形态必须是注释已注入正文的行内视图。**

---

## 2. 注释数据格式（Hint Schema）

每条注释是一个 hint 对象。字段定义如下：

```json
{
  "id": "garden-h003",
  "file": "OEBPS/Text/Section0001_split_001.xhtml",
  "kind": "inline",
  "placement": "after",
  "target": {
    "exact": "理查德·马登",
    "prefix": "我随即辨出那个用德语接电话的声音。是",
    "suffix": "的声音。马登在维克多·鲁纳伯格的",
    "occurrence": 1
  },
  "text": "正在追捕“我”的人",
  "note_type": "reference"
}
```

### 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一，用于去重、更新、失败列表引用。命名建议 `{book/chapterslug}-h{序号}` |
| `file` | 是 | 注释锚定的正文文件路径（章节拆分后可能一章多文件） |
| `kind` | 是 | `block`（段落级方向提示）/ `inline`（短语级指涉标注） |
| `placement` | 是 | `before` / `after`。block 指段落前后；inline 指短语前后（通常 inline 用 after 或直接标注短语本身） |
| `target` | 是 | 锚定信息，见下方【锚定模型】。这是相对参考 JSON 的**关键升级** |
| `text` | 是 | 注释正文。防剧透：只解释"怎么读这段/这个词指谁"，不透露后文情节 |
| `note_type` | 是 | 注释语义类型，见 §3 |

### 锚定模型（target）——相对参考 JSON 的核心升级

参考 JSON 用 `anchor`（一段原文子串）+ `occurrence`（第几次出现）定位。**`occurrence` 单独使用不可靠**：正文重新切分、注释重新生成、或前文出现相同词，计数就会漂移，导致注释插错位或静默消失。

因此采用 **W3C Web Annotation Data Model 的 TextQuoteSelector**，`target` 包含：

| 子字段 | 必填 | 说明 |
|---|---|---|
| `exact` | 是 | 要锚定的确切原文片段（等价于参考 JSON 的 `anchor`） |
| `prefix` | 强烈建议 | `exact` 之前的若干字符原文（建议 10–30 字），用上下文钉死位置 |
| `suffix` | 强烈建议 | `exact` 之后的若干字符原文（建议 10–30 字） |
| `occurrence` | 可选 | 仅作兜底。当 prefix/suffix 缺失时用第几次出现来定位 |

有了 prefix/suffix，即使 `exact` 在全章出现多次，也能靠前后文唯一定位，无需依赖计数。这是本 schema 对参考版单点收益最高的改动，**agent 生成注释时必须产出 prefix/suffix**。

---

## 3. 注释语义类型（note_type）

用于渲染时区分视觉呈现，也便于用户按类型过滤：

| note_type | 含义 | 典型 kind | 示例（小径分叉的花园） |
|---|---|---|---|
| `direction` | 段落级方向提示：这段在做什么、怎么读 | block | "开篇把历史记载与一份缺页证言并置；先留意'延期原因'这一疑问" |
| `reference` | 指涉：某人/某物是谁、与"我"的关系 | inline | "理查德·马登 → 正在追捕'我'的人" |
| `perspective` | 叙事视角标注：这段是谁在说、什么性质的文本 | block/inline | "下文转为第一人称证言记录" |
| `background` | 背景钥匙：历史、格律、意象来源等外部上下文 | block | "赋格是一种复调音乐格律……" |

类型可扩展；渲染器对未知类型走 `direction` 的默认样式。

---

## 4. 文件组织

- 注释 JSON 存在【运行状态文件夹】，不进 Obsidian 库（机器数据）。
- 建议每章一个 JSON：`{运行状态目录}/annotations/{bookId}/{chapterId}.json`，结构为 `{ metadata, hints: [...] }`。
- `metadata` 保留参考 JSON 的字段：`book` / `chapter` / `language` / `policy`（如 `conservative-no-spoilers`）/ `scope`。

> 注：这与主 REQUIREMENTS.md 的"阅读产物进 Obsidian、运行状态进另一文件夹"一致——**注释数据是运行状态**（可重新生成的机器数据），而用户**手动整理的摘录/对话笔记**才是进 Obsidian 的阅读产物。

---

## 5. 渲染器行为规格（Merge & Inject）

**这是当前缺失、最需要 agent 实现的部分。**

### 5.1 禁止事项
- **禁止**对 HTML 字符串做 `str.replace(exact, ...)`。锚点可能跨标签、可能破坏标签结构、可能命中标签属性内部，字符串替换会损坏 DOM。
- 必须走 DOM。

### 5.2 注入算法（DOM 文本节点偏移映射）
1. 把章节正文解析为 DOM。
2. 按文档顺序遍历所有文本节点，拼接成一个纯文本串，同时建立【纯文本字符位置 → (文本节点, 节点内偏移)】的映射表。
3. 对 `target`（exact/prefix/suffix）与拼接文本做**一致的空白归一化**后再匹配（否则偏移对不齐）。
4. 用 `prefix + exact + suffix` 定位唯一匹配；缺 prefix/suffix 时用 `occurrence` 兜底。
5. 把匹配的字符边界通过映射表换算回 DOM 节点位置，在边界处切分文本节点后插入注释节点。

建议直接使用维护中的成熟锚定库（如 Apache Annotator / `dom-anchor-text-quote` 一类），不要手写匹配逻辑——边界情况很多。

### 5.3 两种 kind 的注入方式
- `kind: block`：从匹配位置向上找到所在段落元素，在其前/后（按 `placement`）插入一个 callout 兄弟节点。
- `kind: inline`：只标注命中的短语本身（切分文本节点，包一层标注元素）。

### 5.4 视觉呈现
- `block`（direction/background）：段落上方/下方的 callout 块，读该段前先给方向。
- `inline`（reference/perspective）：给命中短语加下划线或淡色高亮；注释内容通过 **hover/点击浮层**弹出，或作为对齐到该行的**边注（sidenote）**。
  - 默认可用按需浮层，保持正文干净；
  - "精读模式"下可把边注常驻显示。

---

## 6. 失败处理（必须实现，不可省略）

文本匹配一定会偶尔失败（锚点质量、正文变动等）。

- 渲染器**绝不能静默丢弃**未匹配的 hint。
- 未定位成功的 hints → 收集起来，在**章节级**以列表形式展示（即把"注释与正文分离"的旧形态，从默认状态**降级为兜底状态**），并标注哪些 hint 未能锚定。
- 输出一个**匹配率**（成功锚定数 / 总 hint 数），供用户评估注释质量、决定是否重新生成或手动修 anchor。

---

## 7. 渲染环境确认（已拍板，见 §9）

- 若在**自建 HTML 面板**渲染 epub 的 xhtml（当前 JSON 引用 `OEBPS/*.xhtml`，指向这种）：上述 DOM 注入 + 划词浮层**完全适用**，交互体验最好。
- 若在 **Obsidian markdown** 内渲染：锚定逻辑仍成立，但行内浮层在 Obsidian 里难以实现，只能退化为脚注 `[^id]` 或 callout 块，做不到"划词浮出注释"。

> **已确认（2026-07-10）**：主渲染面 = 本应用的自建 HTML 阅读面板（ChapterView），DOM 注入 + 行内浮层；Obsidian markdown 作为**存档形态**，同一份 hints JSON 渲染成 callout + 脚注小节追加进 `注释.md`。两种形态共用同一数据源，详见 §9。

---

## 8. 给实现者的核对清单

- [ ] 正文与注释磁盘上分离，源正文只读、永不写入
- [ ] 实现渲染时合并组件：输入正文 DOM + hints JSON，输出注释已注入的 DOM
- [ ] 锚定用 TextQuoteSelector（exact + prefix + suffix），用成熟库，禁止字符串 replace
- [ ] hint schema 含 prefix/suffix，occurrence 仅兜底
- [ ] 注入走 DOM 文本节点偏移映射：inline 切分节点、block 插兄弟节点
- [ ] 两种视觉：block callout / inline 标注 + 浮层或边注
- [ ] 未匹配 hints → 章节级兜底列表 + 匹配率，**永不静默丢弃**
- [ ] 注释 text 遵守防剧透策略（policy: conservative-no-spoilers）

---

## 9. 实现决策记录（2026-07-10 用户确认）

本节把上文留白处落到本仓库（AI 伴读工具，SPEC.md）的具体实现。与 §1–§6 冲突时以 §1–§6 为准；本节只做落地映射。

### 9.1 触发与既有功能的关系

- **随文注释（本 spec 的 hints）按章手动触发**：右栏注释 Tab 内「生成本章随文注释」按钮，整章送 AI 一次性产出该章 hints JSON。设置中提供「打开新章节自动生成随文注释」开关，**默认关**（费用考虑）。
- 现有**章节导读**卡（单条 markdown，打开章节自动生成）**保留不变**，与 hints 并存。
- 现有**深挖**（选中文字生成右栏长注释卡）本轮**保持现状**，不并入 hint 体系。
- 重新生成 = 整份替换该章 hints JSON（§1 的设计收益）；markdown 存档按追加模式保留历史版本。

### 9.2 锚定库

- 采用 **`@apache-annotator/dom`**（Apache Annotator，W3C Web Annotation TextQuoteSelector 的参考实现，§5.2 点名建议）。
- 匹配管线（每级结果都做归一化校验，失败即降级）：
  1. 完整 selector（exact+prefix+suffix）直接匹配；
  2. exact 单独匹配：唯一命中即取；多命中时按 prefix/suffix 的归一化上下文相似度评分选优；
  3. 空白/引号归一化回退：对章节文本与 selector 做同一归一化后定位，再把命中的**原文切片**作为校正 selector 重新喂给库匹配（DOM 操作始终在库内完成）；
  4. `occurrence` 第 N 次出现兜底；
  5. 全部失败 → 计入未锚定，进 §6 兜底列表。

### 9.3 文件落地（映射 §4 到本仓库状态区结构）

- 路径：`{状态根}/books/{bookId}/hints/{spine 四位序号}.json`（每章一文件；本应用章节以 spine 序号标识，即 §4 的 chapterId）。
- 结构：`{ version: 1, metadata, hints: [...] }`；`metadata` 含 `book / chapter / spine / language / policy: "conservative-no-spoilers" / scope / generatedAt / model / truncated / sourceChars`。
- hint 的 `file` 字段 = 该章在 epub 内的 href（来自章节解析缓存）。
- hint 的 `id` 命名为 `s{spine}-h{序号}-{4位随机}`：随机段保证**重新生成后 markdown 存档中的脚注 id 不与历史版本冲突**（存档只追加、不删除）。

### 9.4 双形态渲染（同一份 hints JSON）

| 形态 | 场景 | block hint | inline hint |
|---|---|---|---|
| HTML 阅读面板（主界面） | ChapterView 渲染时合并 | 段前/段后 callout 块 | 短语淡色标注 + 点击浮层 |
| Obsidian markdown（存档） | 每次生成后渲染成一节「{章节名} · 随文注释」追加进 `注释.md` | `> [!note]` 类 callout（引锚点段首） | 引原文短语 + Obsidian 脚注 `[^id]` |

存档**不写入整章正文**（书的正文不进知识库；追加模式下重复写整章不可接受）。callout 类型映射：direction→`[!note]`、background→`[!info]`、reference→`[!info]`、perspective→`[!quote]`，未知类型→`[!note]`。

### 9.5 生成约束

- AI 只产出 `kind / placement / note_type / target{exact,prefix,suffix} / text`；`id` 与 `file` 由应用分配（减少格式错误面）。
- 上下文与防剧透沿用 SPEC.md §4.3：前文窗口 + 本章全文（超长按 `chapterNoteMaxChars` 截断，截断时 `metadata.truncated = true` 并在面板提示覆盖范围）；prompt 同时要求每条注释只依据其锚点之前的文本。
- 解析容错：流式收完后剥代码围栏、按对象逐个提取（末尾截断的对象丢弃不致整批失败）；字段非法时按 note_type 推断 kind/placement 缺省，`exact` 或 `text` 缺失的条目丢弃。
