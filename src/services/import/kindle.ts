import type { Anchor } from "../../types/models";
import { normalizeForMatch } from "../../lib/utils";

// Kindle "My Clippings.txt" 解析 + 引文回原文定位（SPEC §1.2 excerpts / §6 M5）

export interface Clipping {
  title: string;
  content: string;
}

/** 解析 My Clippings.txt，只取标注（跳过笔记/书签） */
export function parseClippings(text: string): Clipping[] {
  const entries = text.replace(/^﻿/, "").split(/\r?\n==========\r?\n?/);
  const out: Clipping[] = [];
  for (const entry of entries) {
    const lines = entry.split(/\r?\n/).map((l) => l.trim());
    while (lines.length && !lines[0]) lines.shift();
    if (lines.length < 3) continue;
    const title = lines[0].replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
    const metaLine = lines[1];
    const isHighlight = /标注|注释|Highlight/i.test(metaLine) && !/笔记|Note\b|书签|Bookmark/i.test(metaLine);
    if (!isHighlight) continue;
    const content = lines.slice(2).join("\n").trim();
    if (title && content) out.push({ title, content });
  }
  return out;
}

/** 按书名分组，供用户选择导入哪一组 */
export function groupClippings(clips: Clipping[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of clips) {
    const list = map.get(c.title) ?? [];
    list.push(c.content);
    map.set(c.title, list);
  }
  return map;
}

/** 通用文本导入：按空行分条 */
export function parsePlainText(text: string): string[] {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

/**
 * 引文定位：在全书各章的块文本中查找。
 * 精确命中给字符级锚点；归一化命中降级为整块锚点；找不到返回 null。
 */
export function locateQuote(quote: string, chapters: string[][]): { spine: number; anchor: Anchor } | null {
  const clean = quote.trim();
  if (clean.length < 2) return null;

  const anchorOf = (para: number, start: number, endPara: number, end: number, paras: string[]): Anchor => ({
    para,
    start,
    endPara,
    end,
    quote: clean.slice(0, 2000),
    prefix: paras[para].slice(Math.max(0, start - 20), start),
    suffix: paras[endPara].slice(end, end + 20),
  });

  // 1) 单块精确匹配
  for (let s = 0; s < chapters.length; s++) {
    const paras = chapters[s];
    for (let p = 0; p < paras.length; p++) {
      const idx = paras[p].indexOf(clean);
      if (idx >= 0) return { spine: s, anchor: anchorOf(p, idx, p, idx + clean.length, paras) };
    }
  }
  // 2) 归一化单块匹配 → 整块锚点
  const nq = normalizeForMatch(clean);
  if (nq.length >= 4) {
    for (let s = 0; s < chapters.length; s++) {
      const paras = chapters[s];
      for (let p = 0; p < paras.length; p++) {
        if (paras[p] && normalizeForMatch(paras[p]).includes(nq)) {
          return { spine: s, anchor: anchorOf(p, 0, p, paras[p].length, paras) };
        }
      }
    }
    // 3) 归一化跨块匹配（相邻两块拼接）→ 两块整体锚点
    for (let s = 0; s < chapters.length; s++) {
      const paras = chapters[s];
      for (let p = 0; p + 1 < paras.length; p++) {
        if (normalizeForMatch(paras[p] + paras[p + 1]).includes(nq)) {
          return { spine: s, anchor: anchorOf(p, 0, p + 1, paras[p + 1].length, paras) };
        }
      }
    }
  }
  return null;
}
