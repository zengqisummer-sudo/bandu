import type { Anchor } from "../../types/models";
import { normalizeForMatch, truncate } from "../../lib/utils";

/**
 * 锚点系统（SPEC §1.3）。
 * 块序号的确定性是锚点稳定的前提：collectBlocks 在解析缓存与渲染两侧
 * 必须产生一致的编号——两侧都从同一份消毒 HTML 出发调用本函数。
 */

const BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,dt,dd,figcaption,div";

/** 叶子块：匹配块级标签，且内部不再含其他块级标签 */
export function collectBlocks(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)).filter(
    (el) => !el.querySelector(BLOCK_SELECTOR)
  );
}

export function numberBlocks(root: ParentNode): HTMLElement[] {
  const blocks = collectBlocks(root);
  blocks.forEach((b, i) => b.setAttribute("data-para", String(i)));
  return blocks;
}

function closestBlock(node: Node): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return el?.closest<HTMLElement>("[data-para]") ?? null;
}

/** (node, offset) → 块内 textContent 字符偏移 */
function textOffsetIn(block: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(block);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

/** 块内字符偏移 → (textNode, offset) */
function posToNode(block: HTMLElement, charOffset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  let t = walker.nextNode() as Text | null;
  while (t) {
    const len = t.data.length;
    if (acc + len >= charOffset) return { node: t, offset: charOffset - acc };
    acc += len;
    last = t;
    t = walker.nextNode() as Text | null;
  }
  if (last) return { node: last, offset: last.data.length };
  return { node: block, offset: 0 };
}

export function createAnchorFromRange(range: Range): Anchor | null {
  const startBlock = closestBlock(range.startContainer);
  const endBlock = closestBlock(range.endContainer);
  if (!startBlock || !endBlock) return null;
  const para = Number(startBlock.dataset.para);
  const endPara = Number(endBlock.dataset.para);
  if (Number.isNaN(para) || Number.isNaN(endPara) || endPara < para) return null;

  const start = textOffsetIn(startBlock, range.startContainer, range.startOffset);
  const end = textOffsetIn(endBlock, range.endContainer, range.endOffset);
  if (para === endPara && end <= start) return null;

  const quote = truncate(range.toString(), 2000);
  const startText = startBlock.textContent ?? "";
  const endText = endBlock.textContent ?? "";
  return {
    para,
    start,
    endPara,
    end,
    quote,
    prefix: startText.slice(Math.max(0, start - 20), start),
    suffix: endText.slice(end, end + 20),
  };
}

function rangeFromOffsets(startBlock: HTMLElement, start: number, endBlock: HTMLElement, end: number): Range | null {
  const s = posToNode(startBlock, start);
  const e = posToNode(endBlock, end);
  const r = document.createRange();
  try {
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  return r.collapsed ? null : r;
}

/**
 * 锚点 → Range。三级策略：偏移直取（校验 quote）→ 原文精确搜索 → 归一化段落级兜底。
 * 返回 null 表示"失锚"：注释仍在面板显示，正文不高亮。
 */
export function resolveAnchor(blocks: HTMLElement[], anchor: Anchor): Range | null {
  const sb = blocks[anchor.para];
  const eb = blocks[anchor.endPara];
  if (sb && eb) {
    const r = rangeFromOffsets(sb, anchor.start, eb, anchor.end);
    if (r && normalizeForMatch(r.toString()) === normalizeForMatch(anchor.quote)) return r;
  }
  // 精确重定位（单块内）
  const rawQuote = anchor.quote.replace(/…$/, "");
  if (rawQuote.length >= 4) {
    for (const b of blocks) {
      const text = b.textContent ?? "";
      const idx = text.indexOf(rawQuote);
      if (idx >= 0) return rangeFromOffsets(b, idx, b, idx + rawQuote.length);
    }
  }
  // 归一化段落级兜底：高亮整块
  const nq = normalizeForMatch(anchor.quote);
  if (nq.length >= 4) {
    for (const b of blocks) {
      if (normalizeForMatch(b.textContent ?? "").includes(nq)) {
        const len = (b.textContent ?? "").length;
        return rangeFromOffsets(b, 0, b, len);
      }
    }
  }
  return null;
}
