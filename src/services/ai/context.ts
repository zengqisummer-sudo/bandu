import type { BookMeta, TocItem } from "../../types/models";
import { chapterText } from "../epub/parse";

/**
 * 上下文窗口组装（SPEC §4.3）。
 * 防剧透边界在这里用代码裁剪：给定位置之后的文本绝不进入上下文。
 */

export interface Boundary {
  spine: number;
  /** 章内块序号；null 表示边界在本章开头（即只取之前章节） */
  para: number | null;
  /** 块内字符偏移；配合 para 使用 */
  offset?: number;
}

/** 边界之前的文本窗口，按阅读顺序拼接，总长不超过 chars */
export async function beforeWindow(bookId: string, boundary: Boundary, chars: number): Promise<string> {
  if (chars <= 0) return "";
  const pieces: string[] = []; // 逆序收集
  let remaining = chars;

  const takeFromEnd = (paras: string[]) => {
    for (let i = paras.length - 1; i >= 0 && remaining > 0; i--) {
      const t = paras[i].trim();
      if (!t) continue;
      if (t.length <= remaining) {
        pieces.push(t);
        remaining -= t.length;
      } else {
        pieces.push("…" + t.slice(t.length - remaining));
        remaining = 0;
      }
    }
  };

  // 本章边界之前的部分
  if (boundary.para != null && boundary.para >= 0) {
    const paras = await chapterText(bookId, boundary.spine).catch(() => [] as string[]);
    const inChapter = paras.slice(0, boundary.para);
    const partial = paras[boundary.para]?.slice(0, boundary.offset ?? 0) ?? "";
    takeFromEnd(partial.trim() ? [...inChapter, partial] : inChapter);
  }

  // 向前遍历之前的章节
  for (let s = boundary.spine - 1; s >= 0 && remaining > 0; s--) {
    const paras = await chapterText(bookId, s).catch(() => [] as string[]);
    takeFromEnd(paras);
  }

  return pieces.reverse().join("\n");
}

/** 本章全文（章节导读用），超长头部保留截断 */
export async function chapterFullText(
  bookId: string,
  spine: number,
  maxChars: number
): Promise<{ text: string; truncated: boolean }> {
  const paras = await chapterText(bookId, spine);
  const full = paras.filter((p) => p.trim()).join("\n");
  if (full.length <= maxChars) return { text: full, truncated: false };
  return { text: full.slice(0, maxChars), truncated: true };
}

function flattenToc(items: TocItem[], out: TocItem[] = []): TocItem[] {
  for (const it of items) {
    out.push(it);
    flattenToc(it.children, out);
  }
  return out;
}

/** 已读章节标题列表（≤ 当前 spine 的目录项） */
export function readChapterTitles(book: BookMeta, uptoSpine: number): string[] {
  return flattenToc(book.toc)
    .filter((t) => t.spine >= 0 && t.spine <= uptoSpine)
    .map((t) => t.label);
}

/** 当前 spine 对应的目录标签（取最近的前置目录项） */
export function chapterLabelFor(book: BookMeta, spine: number): string {
  if (spine < 0) return "未定位";
  let best: string | null = null;
  for (const t of flattenToc(book.toc)) {
    if (t.spine >= 0 && t.spine <= spine) best = t.label;
    if (t.spine > spine) break;
  }
  return best ?? `第 ${spine + 1} 节`;
}
