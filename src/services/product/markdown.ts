import { ideaTopics, topicLine } from "../../lib/topics";
import type { Annotation, BookMeta, ChatSession, ChatTurn, Excerpt, HintsFile } from "../../types/models";
import { storage } from "../storage";
import { paths } from "../storage/paths";
import { chapterLabelFor } from "../ai/context";
import { calloutTag, noteTypeLabel } from "../hints/noteTypes";
import { isTagLine, tagLine } from "../../lib/tags";
import { dateStr, truncate } from "../../lib/utils";

// 产物 markdown 模板与写入（SPEC §1.4 / §1.5）。
// 所有写入走 storage().appendMarkdown —— 只追加，绝不覆盖。

function yamlValue(v: string): string {
  return /[:#\-[\]{}"'|>&%@`]/.test(v) ? JSON.stringify(v) : v || '""';
}

function frontmatter(book: BookMeta, type: string): string {
  const lines = [`---`, `书名: ${yamlValue(book.title)}`];
  if (book.author) lines.push(`作者: ${yamlValue(book.author)}`);
  lines.push(`类型: ${type}`, `来源: AI伴读`, `---`);
  return lines.join("\n") + "\n";
}

/** HTML 注释内的机器元数据；字段值均为受控内容，防御性替换 "--" */
function metaComment(tag: string, data: Record<string, unknown>): string {
  return `<!-- ${tag} ${JSON.stringify(data).replace(/--/g, "—")} -->`;
}

function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => `> ${l.trim()}`)
    .join("\n");
}

export async function appendAnnotationMd(book: BookMeta, anno: Annotation): Promise<void> {
  const label = chapterLabelFor(book, anno.spine);
  const quotePart = anno.anchor ? ` · 「${truncate(anno.anchor.quote.replace(/\s+/g, " "), 14)}」` : "";
  const heading =
    anno.kind === "chapter"
      ? `## ${label} · 章节导读`
      : anno.source === "user"
        ? `## ${label} · 想法${quotePart}`
        : `## ${label}${quotePart}`;
  const meta = metaComment("ai-anno", {
    id: anno.id,
    kind: anno.kind,
    spine: anno.spine,
    para: anno.anchor?.para,
    source: anno.source ?? "ai",
    t: anno.createdAt,
  });
  const parts = ["---", "", heading, meta, ""];
  if (anno.kind === "passage" && anno.anchor) parts.push(quoteBlock(anno.anchor.quote), "");
  if (ideaTopics(anno).length) parts.push(topicLine(ideaTopics(anno)));
  parts.push(anno.content.trim());
  for (const entry of anno.entries ?? []) {
    parts.push("", `### 追加想法 · ${entry.createdAt}`, "", entry.content.trim());
  }
  await storage().appendMarkdown(anno.source === "user" && anno.kind === "passage" ? paths.productIdeas(book.productDir) : paths.productNotes(book.productDir), parts.join("\n"), frontmatter(book, anno.source === "user" ? "想法" : "阅读注释"));
}

/**
 * 批注内容变更单向同步进 阅读注释.md（伴读 → Obsidian，永不反向）：
 * 定位该条的 ai-anno 元数据行，只重写它名下的正文段（标题/元数据/引文块保持不动），
 * 块尾以下一条「--- + 空行 + ## 标题」为界。找不到该条（历史文件被手动整理过、
 * 或读者只在 Obsidian 里改过）则静默放弃，应用内 JSON 始终是准绳。
 */
export async function updateAnnotationMd(book: BookMeta, anno: Annotation): Promise<boolean> {
  const marker = `<!-- ai-anno `;
  const idToken = `"id":${JSON.stringify(anno.id)}`;
  return storage().rewriteMarkdown(paths.productNotes(book.productDir), (text) => {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith(marker) && l.includes(idToken));
    if (at < 0) return null;
    // 下一块起点：独立的 "---" 后紧跟空行与 "## 标题"（避免把正文里的 --- 误判为块界）
    const isBlockSep = (i: number) =>
      lines[i] === "---" && lines[i + 1] === "" && (lines[i + 2]?.startsWith("## ") ?? false);
    let end = at + 1;
    while (end < lines.length && !isBlockSep(end)) end++;
    const head = lines.slice(0, at + 1); // 含标题与元数据行
    const body: string[] = [""];
    if (anno.kind === "passage" && anno.anchor) body.push(quoteBlock(anno.anchor.quote), "");
    body.push(anno.content.trim());
    const tail = lines.slice(end); // 从下一块的 "---" 开始；末块时为空
    const next = (tail.length ? [...head, ...body, "", ...tail] : [...head, ...body]).join("\n");
    if (next === text) return text;
    return text.endsWith("\n") && !next.endsWith("\n") ? next + "\n" : next;
  });
}

/**
 * 随文注释存档（ANNOTATION_SPEC §9.4）：同一份 hints JSON 的 Obsidian 形态。
 * block → callout；inline → 引原文短语 + 脚注 [^id]（id 含随机段，历史版本不冲突）。
 * 每次生成追加一节，不写入整章正文。
 */
export async function appendHintsMd(book: BookMeta, file: HintsFile): Promise<void> {
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const label = file.metadata.chapter || chapterLabelFor(book, file.metadata.spine);
  const meta = metaComment("ai-hints", {
    spine: file.metadata.spine,
    count: file.hints.length,
    t: file.metadata.generatedAt,
  });
  const parts: string[] = ["---", "", `## ${label} · 随文注释`, meta, ""];

  const blocks = file.hints.filter((h) => h.kind === "block");
  const inlines = file.hints.filter((h) => h.kind !== "block");

  for (const h of blocks) {
    const where = h.placement === "after" ? "段后" : "段前";
    parts.push(
      `> [!${calloutTag(h.note_type)}] ${noteTypeLabel(h.note_type)}（${where}）· 「${truncate(oneLine(h.target.exact), 14)}」`,
      `> ${oneLine(h.text)}`,
      ""
    );
  }
  if (inlines.length > 0) {
    for (const h of inlines) parts.push(`- 「${oneLine(h.target.exact)}」[^${h.id}]`);
    parts.push("");
    for (const h of inlines) parts.push(`[^${h.id}]: ${oneLine(h.text)}（${noteTypeLabel(h.note_type)}）`);
  }

  await storage().appendMarkdown(
    paths.productNotes(book.productDir),
    parts.join("\n").trimEnd(),
    frontmatter(book, "阅读注释")
  );
}

export async function appendExcerptMd(book: BookMeta, ex: Excerpt): Promise<void> {
  const label = ex.spine >= 0 ? chapterLabelFor(book, ex.spine) : "未定位";
  const sourceLabel = ex.source === "kindle" ? " · Kindle 导入" : ex.source === "text" ? " · 文本导入" : "";
  const meta = metaComment("ai-excerpt", { id: ex.id, spine: ex.spine, t: ex.createdAt });
  // 标签行紧跟摘录文字块（meta 注释在 Obsidian 预览中不可见）
  const parts = ["---", "", quoteBlock(ex.quote), meta];
  if (ex.tags?.length) parts.push(tagLine(ex.tags));
  parts.push("", `— ${label}${sourceLabel}`);
  if (ex.note?.trim()) parts.push("", ex.note.trim());
  await storage().appendMarkdown(paths.productExcerpts(book.productDir), parts.join("\n"), frontmatter(book, "摘录"));
}

/**
 * 摘录标签变更同步进 摘录.md：定位该条的 ai-excerpt 元数据行，
 * 增/换/删紧随其后的标签行——只动这一行（storage.rewriteMarkdown 例外通道）。
 * 找不到该条（历史文件被手动整理过等）则静默放弃，应用内 JSON 仍是准绳。
 */
export async function updateExcerptTagsMd(book: BookMeta, ex: Excerpt): Promise<boolean> {
  const marker = `<!-- ai-excerpt `;
  const idToken = `"id":${JSON.stringify(ex.id)}`;
  return storage().rewriteMarkdown(paths.productExcerpts(book.productDir), (text) => {
    const lines = text.split("\n");
    const at = lines.findIndex((l) => l.startsWith(marker) && l.includes(idToken));
    if (at < 0) return null;
    const hasOld = at + 1 < lines.length && isTagLine(lines[at + 1]);
    const next = [...lines];
    if (ex.tags?.length) next.splice(at + 1, hasOld ? 1 : 0, tagLine(ex.tags));
    else if (hasOld) next.splice(at + 1, 1);
    else return text; // 无旧无新，无事可做
    return next.join("\n");
  });
}

function sessionHeader(book: BookMeta, session: ChatSession): string {
  const label = chapterLabelFor(book, session.context.spine);
  const pct = Math.round(session.context.percent * 100);
  const quotePart = session.context.quote ? `，选中「${truncate(session.context.quote.replace(/\s+/g, " "), 40)}」` : "";
  return [`---`, ``, `## ${dateStr(session.createdAt)} · ${session.title}`, `> 语境：读至${label} ${pct}%${quotePart}`].join("\n");
}

function resumeHeader(session: ChatSession): string {
  return [`---`, ``, `## ${session.title}（续）`].join("\n");
}

function turnBlock(turn: ChatTurn): string {
  return turn.role === "user" ? `**我**：${turn.content.trim()}` : `**AI**：\n\n${turn.content.trim()}`;
}

/**
 * 追加会话新轮次。header 取值：
 * "new" 会话首次写入；"resume" 中间插过别的会话，补（续）头；null 直接续写。
 */
export async function appendChatTurnsMd(
  book: BookMeta,
  session: ChatSession,
  turns: ChatTurn[],
  header: "new" | "resume" | null
): Promise<void> {
  const parts: string[] = [];
  if (header === "new") parts.push(sessionHeader(book, session));
  if (header === "resume") parts.push(resumeHeader(session));
  parts.push(`<!-- idea ${session.id} -->`);
  if (ideaTopics(session).length) parts.push(topicLine(ideaTopics(session)));
  for (const t of turns) parts.push(turnBlock(t));
  await storage().appendMarkdown(
    paths.productIdeas(book.productDir),
    parts.join("\n\n"),
    frontmatter(book, "阅读对话")
  );
}
