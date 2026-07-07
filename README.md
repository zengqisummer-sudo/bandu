# 伴读 — AI 阅读工具

帮你读懂难读的书：epub 阅读器 + 随文 AI 注释 + 阅读中随时对话，产物写成 Obsidian 可索引的 markdown。

- **随文注释**：打开新章节自动生成"章节导读"；选中文字「深挖」生成锚定注释（防剧透：只依据已读文本）
- **对话**：随时就已读内容提问讨论，AI 持有阅读进度上下文；每轮自动落盘 markdown
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
