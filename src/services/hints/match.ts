import { createTextQuoteSelectorMatcher } from "@apache-annotator/dom";
import type { Hint, HintTarget } from "../../types/models";
import { normalizeChar, normalizeForMatch } from "../../lib/utils";

/**
 * 随文注释锚定管线（ANNOTATION_SPEC §5.2 / §9.2）。
 * DOM 内的定位与文本节点遍历全部交给 @apache-annotator/dom（W3C TextQuoteSelector
 * 参考实现）；本模块只做候选排序与"归一化文本 → 原文切片"的纯字符串换算，
 * 绝不直接操作 DOM、绝不做字符串 replace。
 *
 * 逐级降级（每级结果都经 verified 校验，失败进入下一级）：
 *   1. exact + prefix + suffix 完整匹配
 *   2. exact 单独匹配：唯一命中直取；多命中按归一化上下文相似度选优
 *   3. 空白/引号归一化后在章节文本中定位，取原文切片作校正 selector 重新匹配
 *   4. occurrence 第 N 次出现兜底
 *   5. 全部失败 → 未锚定（由调用方进兜底列表，绝不静默丢弃）
 */

export interface HintMatch {
  hint: Hint;
  range: Range;
  method: "quote" | "context" | "normalized" | "occurrence";
}

export interface MatchOutcome {
  matches: HintMatch[];
  missed: Hint[];
}

const MAX_CANDIDATES = 24;

interface QuoteSelector {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** 库匹配：收集 scope 内的候选 Range（异步生成器，最多 cap 个） */
async function collectMatches(scope: HTMLElement, sel: QuoteSelector, cap = MAX_CANDIDATES): Promise<Range[]> {
  const out: Range[] = [];
  try {
    const matcher = createTextQuoteSelectorMatcher({
      type: "TextQuoteSelector",
      exact: sel.exact,
      prefix: sel.prefix || undefined,
      suffix: sel.suffix || undefined,
    });
    for await (const range of matcher(scope)) {
      out.push(range);
      if (out.length >= cap) break;
    }
  } catch {
    /* 异常输入（如空串）视为无命中 */
  }
  return out;
}

/** 结果校验：命中文本与 exact 在归一化后必须一致 */
function verified(range: Range, exact: string): boolean {
  if (range.collapsed) return false;
  return normalizeForMatch(range.toString()) === normalizeForMatch(exact);
}

/** 取 range 前后的实际原文（用 Range 读取，不改 DOM） */
function contextAround(scope: HTMLElement, range: Range, chars: number): { before: string; after: string } {
  const doc = scope.ownerDocument ?? document;
  let before = "";
  let after = "";
  try {
    const b = doc.createRange();
    b.selectNodeContents(scope);
    b.setEnd(range.startContainer, range.startOffset);
    before = b.toString().slice(-chars);
    const a = doc.createRange();
    a.selectNodeContents(scope);
    a.setStart(range.endContainer, range.endOffset);
    after = a.toString().slice(0, chars);
  } catch {
    /* 边界异常时按空上下文计分 */
  }
  return { before, after };
}

/** a 的结尾与 b 的重合长度（b 应作为 a 的后缀出现） */
function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/** a 的开头与 b 的重合长度（b 应作为 a 的前缀出现） */
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 多候选评分：prefix/suffix 归一化后与候选实际上下文的贴合度 */
function scoreCandidate(scope: HTMLElement, range: Range, normPrefix: string, normSuffix: string): number {
  const span = Math.max(normPrefix.length, normSuffix.length) * 2 + 8;
  const { before, after } = contextAround(scope, range, span);
  let score = 0;
  if (normPrefix) score += commonSuffixLen(normalizeForMatch(before), normPrefix);
  if (normSuffix) score += commonPrefixLen(normalizeForMatch(after), normSuffix);
  return score;
}

/** 章节文本的归一化视图：norm 的每个 UTF-16 单元都映射回 raw 的原始偏移 */
interface NormalizedDoc {
  raw: string;
  norm: string;
  rawIndex: number[];
}

function buildNormalizedDoc(scope: HTMLElement): NormalizedDoc {
  const doc = scope.ownerDocument ?? document;
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  let raw = "";
  let t = walker.nextNode() as Text | null;
  while (t) {
    raw += t.data;
    t = walker.nextNode() as Text | null;
  }
  let norm = "";
  const rawIndex: number[] = [];
  let i = 0;
  for (const ch of raw) {
    const c = normalizeChar(ch);
    if (c) {
      norm += c;
      // c 可能是代理对（2 个 UTF-16 单元），逐单元登记原始偏移，保证 norm 与 rawIndex 等长
      for (let k = 0; k < c.length; k++) rawIndex.push(i + k);
    }
    i += ch.length;
  }
  return { raw, norm, rawIndex };
}

/** 在归一化文本中定位 target，返回 raw 文本中的 [start, end) */
function findNormalized(docN: NormalizedDoc, target: HintTarget): { start: number; end: number } | null {
  const nExact = normalizeForMatch(target.exact);
  if (nExact.length < 2) return null;
  const nPrefix = target.prefix ? normalizeForMatch(target.prefix) : "";
  const nSuffix = target.suffix ? normalizeForMatch(target.suffix) : "";

  const hits: number[] = [];
  let idx = docN.norm.indexOf(nExact);
  while (idx >= 0 && hits.length < 200) {
    hits.push(idx);
    idx = docN.norm.indexOf(nExact, idx + 1);
  }
  if (hits.length === 0) return null;

  let best = hits[0];
  if (hits.length > 1) {
    if (nPrefix || nSuffix) {
      let bestScore = -1;
      for (const h of hits) {
        const before = docN.norm.slice(Math.max(0, h - nPrefix.length - 8), h);
        const after = docN.norm.slice(h + nExact.length, h + nExact.length + nSuffix.length + 8);
        const s = commonSuffixLen(before, nPrefix) + commonPrefixLen(after, nSuffix);
        if (s > bestScore) {
          bestScore = s;
          best = h;
        }
      }
    } else if (target.occurrence && target.occurrence >= 1 && target.occurrence <= hits.length) {
      best = hits[target.occurrence - 1];
    }
  }
  return { start: docN.rawIndex[best], end: docN.rawIndex[best + nExact.length - 1] + 1 };
}

/**
 * 归一化命中的原文切片 → 校正 selector → 重新交给库匹配。
 * 切片逐字来自 DOM 文本，必然精确命中；带原文上下文消歧重复。
 */
async function rangeFromRawSlice(
  scope: HTMLElement,
  docN: NormalizedDoc,
  start: number,
  end: number
): Promise<Range | null> {
  const exact = docN.raw.slice(start, end);
  if (!exact) return null;
  const prefix = docN.raw.slice(Math.max(0, start - 20), start);
  const suffix = docN.raw.slice(end, end + 20);
  const cands = await collectMatches(scope, { exact, prefix, suffix }, 2);
  if (cands[0]) return cands[0];
  // 上下文本身跨越 scope 边界等极端情况：放宽为 exact 单独匹配取第一个
  const loose = await collectMatches(scope, { exact }, 2);
  return loose[0] ?? null;
}

async function matchOne(scope: HTMLElement, hint: Hint, getDoc: () => NormalizedDoc): Promise<HintMatch | null> {
  const t = hint.target;
  if (!t?.exact?.trim()) return null;
  const exact = t.exact;

  // 1) 完整 selector
  if (t.prefix || t.suffix) {
    const full = await collectMatches(scope, { exact, prefix: t.prefix, suffix: t.suffix }, 2);
    if (full[0] && verified(full[0], exact)) return { hint, range: full[0], method: "quote" };
  }

  // 2) exact 单独匹配
  const cands = await collectMatches(scope, { exact });
  if (cands.length === 1 && verified(cands[0], exact)) {
    return { hint, range: cands[0], method: t.prefix || t.suffix ? "context" : "quote" };
  }
  if (cands.length > 1) {
    if (t.prefix || t.suffix) {
      const nP = t.prefix ? normalizeForMatch(t.prefix) : "";
      const nS = t.suffix ? normalizeForMatch(t.suffix) : "";
      let pick: Range | null = null;
      let bestScore = 0; // 得分为 0 = 上下文完全不贴合，此时不信任评分，落到 occurrence
      for (const r of cands) {
        const s = scoreCandidate(scope, r, nP, nS);
        if (s > bestScore) {
          bestScore = s;
          pick = r;
        }
      }
      if (pick && verified(pick, exact)) return { hint, range: pick, method: "context" };
    }
    // 4) occurrence 兜底（无上下文，或上下文评分全为 0）
    const occ = t.occurrence && t.occurrence >= 1 ? t.occurrence : 1;
    const pick = cands[Math.min(occ, cands.length) - 1];
    if (pick && verified(pick, exact)) return { hint, range: pick, method: "occurrence" };
  }

  // 3) 归一化回退（AI 抄写时的空白/引号出入）
  const docN = getDoc();
  const span = findNormalized(docN, t);
  if (span) {
    const r = await rangeFromRawSlice(scope, docN, span.start, span.end);
    if (r && verified(r, exact)) return { hint, range: r, method: "normalized" };
  }
  return null;
}

/**
 * 只读匹配：不改动 DOM，可在任意时刻安全执行。
 * 注入（会改 DOM）由 inject.ts 在全部匹配完成后统一进行。
 */
export async function matchHints(scope: HTMLElement, hints: Hint[], cancelled: () => boolean = () => false): Promise<MatchOutcome> {
  const matches: HintMatch[] = [];
  const missed: Hint[] = [];
  let docN: NormalizedDoc | null = null;
  const getDoc = () => (docN ??= buildNormalizedDoc(scope));
  let yieldedAt = performance.now();
  for (const hint of hints) {
    if (cancelled()) break;
    const m = await matchOne(scope, hint, getDoc).catch(() => null);
    if (m) matches.push(m);
    else missed.push(hint);
    if (performance.now() - yieldedAt > 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      yieldedAt = performance.now();
    }
  }
  return { matches, missed };
}
