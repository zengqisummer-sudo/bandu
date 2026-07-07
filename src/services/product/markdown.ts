import type { Annotation, BookMeta, ChatSession, ChatTurn, Excerpt } from "../../types/models";
import { storage } from "../storage";
import { paths } from "../storage/paths";
import { chapterLabelFor } from "../ai/context";
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
  const heading =
    anno.kind === "chapter"
      ? `## ${label} · 章节导读`
      : `## ${label} · 「${truncate(anno.anchor?.quote.replace(/\s+/g, " ") ?? "", 14)}」`;
  const meta = metaComment("ai-anno", {
    id: anno.id,
    kind: anno.kind,
    spine: anno.spine,
    para: anno.anchor?.para,
    t: anno.createdAt,
  });
  const parts = ["---", "", heading, meta, ""];
  if (anno.kind === "passage" && anno.anchor) parts.push(quoteBlock(anno.anchor.quote), "");
  parts.push(anno.content.trim());
  await storage().appendMarkdown(paths.productNotes(book.productDir), parts.join("\n"), frontmatter(book, "阅读注释"));
}

export async function appendExcerptMd(book: BookMeta, ex: Excerpt): Promise<void> {
  const label = ex.spine >= 0 ? chapterLabelFor(book, ex.spine) : "未定位";
  const sourceLabel = ex.source === "kindle" ? " · Kindle 导入" : ex.source === "text" ? " · 文本导入" : "";
  const meta = metaComment("ai-excerpt", { id: ex.id, spine: ex.spine, t: ex.createdAt });
  const parts = ["---", "", quoteBlock(ex.quote), meta, "", `— ${label}${sourceLabel}`];
  if (ex.note?.trim()) parts.push("", ex.note.trim());
  await storage().appendMarkdown(paths.productExcerpts(book.productDir), parts.join("\n"), frontmatter(book, "摘录"));
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
  for (const t of turns) parts.push(turnBlock(t));
  await storage().appendMarkdown(
    paths.productChats(book.productDir),
    parts.join("\n\n"),
    frontmatter(book, "阅读对话")
  );
}
