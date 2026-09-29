# 伴读 2.0

注释帮助理解、想法支持输出、摘录保存知识。2.0 需求和实现说明见 [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) 和 [docs/SPEC.md](docs/SPEC.md)。

# 伴读 — AI 阅读工具

帮你读懂难读的书：epub 阅读器 + 随文 AI 注释 + 阅读中随时对话，产物写成 Obsidian 可索引的 markdown。

- **注释**：全书联网导读、章节原文导读、手写优先的随文脚注；悬停浮层，可编辑并同步全文。
- **想法**：手写想法与 AI 多轮对话卡；支持跨书独立话题与卡片链接，侧边栏默认仅展示本书；追加存档到 想法.md。
- **摘录**：选中摘录 / Kindle `My Clippings.txt` 导入 / 粘贴文本导入，自动回原文定位
- **数据即文件**：注释/对话/摘录 → Obsidian 库内 markdown（只追加，不覆盖手动编辑）；进度/缓存 → 库外 JSON
- **无后端**：BYOK（DeepSeek / Anthropic / 任意 OpenAI 兼容端点），key 只存本机浏览器

## 使用

需要 Chrome / Edge（依赖 File System Access API）。

```bash
npm install
npm run dev       # 本地开发
npm run build     # 构建静态产物（dist/），可部署 Vercel / GitHub Pages
```

首次打开按向导：选存储模式（推荐文件夹模式）→ 授权产物/状态两个文件夹 → 填 API key → 导入 epub。

文档：需求 [REQUIREMENTS.md](REQUIREMENTS.md) · 技术规格 [SPEC.md](SPEC.md) · 开发上下文 [AGENTS.md](AGENTS.md)

## 2.0 验收

在日常的 http://localhost:5180 刷新。全书导读需先在设置填写独立的联网模型（Responses web_search 或 Anthropic 网页搜索）、地址与 key；普通聊天配置继续用于章节导读、AI 问书和脚注生成。

不新增测试集，代码类型检查与构建通过后由用户操作验收。操作重点见 docs/IMPLEMENTATION_PLAN.md。
