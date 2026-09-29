# 2.0 技术增量

## 友好排版修订（2026-09-29）

圆括号（全角、半角及嵌套）内部不按句末标点拆行，仍允许按页面宽度自然折行。友好模式统一取消正文块的首行缩进，包含短段与单句段；关闭后恢复原文模式。

切换先绘制持续的排版中提示，再更新阅读偏好；章节在离屏 DOM 中编号、排版后一次挂载。断点插入复用一次收集的文本节点及反向游标，保持 textContent 与块编号不变。实际长章节耗时由用户使用原书验收，不以构建通过代替性能结论。

沿用 React/zustand、存储抽象与 UI 样式。新增 footnotes.json 存储全书随文注释和全书导读；旧 hints 的 inline 读取为注释，block 在导读展示。想法沿用用户 Annotation 和 ChatSession，补充 tags 与对话 Anchor。跨书分组读取各书 JSON，单卡多标签不复制数据。

注释继续使用 apache-annotator TextQuoteSelector 匹配与 highlightText；全书共享注释在每章渲染时按完全相同字符匹配所有位置。先匹配独立注释，再补共享范围。保持编号先于注入；想法/摘录采用 Custom Highlight，点击用 Range 的屏幕矩形命中，注释优先。

产物编辑以 JSON 为准，2.0 注释/想法更新追加 Markdown 历史，不整写用户产物。密钥仅 localStorage。全书导读提供独立联网配置（Responses web_search / Anthropic web_search），验证工具调用和来源；失败不冒充搜索成功。

返回点在首次侧边栏跳转前保留，临时查阅不覆盖阅读进度。构建完成写入 dist，5180 留给稳定预览。

联网协议依据：[OpenAI Web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[Anthropic Web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)。支持情况仍依赖实际提供商、模型权限与浏览器 CORS；失败必须明确显示，不能降级为伪联网导读。

## 想法卡与话题修订

Annotation/ChatSession 新增 topics 字段，与 Excerpt.tags 分离；旧想法的 tags 仅作为兼容读取回退，topics=[] 明确表示无话题。独立词库 aireader.topics.v1，不修改 aireader.tags.v1。Markdown 以普通“话题：…”文本追加，不再生成话题标签。

IdeasTab 的主列表只取本书。其他书卡片进入 catalog，用于话题候选、关联数量、链接搜索和明确展开的平铺预览。关系根据 topics 交集派生，按 bookId+id 去重，不创建卡片副本。编辑与待链接目标在本地草稿保存；点击保存后逐目标重读状态并写入。跨书部分失败明确提示且可幂等重试。

菜单、创建时间、索引条与堆叠由 IdeaCard 实现；链接编辑独立为 IdeaLinksEditor。未改变摘录 TagInput、标签词库及标签存档逻辑。

## 注释定位与摘录合并

注释定位复用 matchFootnotes 与 TextQuoteSelector，保留独立注释优先规则。每处 Range 转独立 Anchor，跳转后通过 Custom Highlight 精确定位。页码读取 EPUB pagebreak / doc-pagebreak 与 page-list 目标，仅在单独的只读 DOM 中标记；不更新章节缓存、消毒规则或块编号。无法取得页码时回退章节名。

Excerpt 可选 segments 保存原摘录各段的 spine、anchor、quote、note；quote 同步合成分段文本用于现有图片导出和 Markdown。旧摘录无需迁移，再次合并展平 segments。合并写 JSON 失败回滚，成功后追加 Markdown，不重写历史摘录。正文高亮和点击遍历所有 segments。

## 注释页签性能（2026-09-29）

页码仅对接近可见区域的卡片计算，任务串行并在浏览器空闲时启动；离开页签取消未开始的任务及结果更新。章节只读 DOM 按 EPUB 实例复用，无页码标记直接返回章节名，不执行原文匹配。页码结果按书籍元数据与目标锚点缓存，正文注释编辑不使页码失效；缓存上限 1000 条，不落盘。静态检查与构建不代表原书运行时性能验收。
