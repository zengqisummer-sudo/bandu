/**
 * 友好阅读模式（纯渲染层，SPEC 不变式约束下的实现）。
 *
 * 大段文字按句读拆行，降低阅读压力；原书分段用分割线标示。
 *
 * 铁律：
 * - 不碰 epub 与章节缓存（正文源只读）；只在渲染 DOM 上动手。
 * - 插入的元素一律不含文字（空 span），块的 textContent 逐字不变——
 *   这样锚点偏移（anchor.ts）、随文注释匹配（match.ts）、AI 上下文（paras 缓存）全部不受影响。
 * - 不给注入元素加 data-para，也不用 div（collectBlocks 会把叶子 div 计入块编号）。
 * - 在 numberBlocks 之后、hints 注入之前执行；关闭模式 = 重新注入 innerHTML，无需清理逻辑。
 *
 * 断行规则（兼顾易读性与原文完整）：
 * 1. 句末断行：。！？；…… 之后断，紧随的右引号/右括号并入本行；
 * 2. 引号分对话与引用：引号内含句末标点(。！？…) → 对话，左引号前、右引号后各断一次独立成行，
 *    但对话内部的句末标点不再断行（“他生气了。他走了。” 整句连排，不从中间拆开）；
 *    引号内无标点或只含句间标点(、，；：) → 引用，不作特殊处理，随通用句末规则断行；
 * 3. 圆括号（全角/半角，可嵌套）内部不拆行；防碎片：断点距上一断点不足 2 字则跳过；段末不留空行；
 * 4. 段落门槛：整段不足 36 字不处理——短段、诗行、标题保持原样。
 * 分割线只出现在"发生过拆行"的段落边界：没拆过的区域（如诗歌）保持原书样貌。
 */

const ENDERS = new Set(["。", "！", "？", "；", "…", "!", "?"]);
const CLOSERS = new Set(["」", "』", "”", "’", "）", "〕", "】", "》", "〉", ")"]);
/** 引号配对；遇到左引号先找配对右引号，按内容判定对话/引用 */
const PAIRS: Record<string, string> = { "「": "」", "『": "』", "“": "”", "‘": "’" };
/** 对话判定：引号内含句末标点(。！？…)即视为对话；无标点或仅含句间标点(、，；：)视为引用 */
const DIALOGUE_MARK = /[。！？…!?]/;
/** 右引号后紧跟这些字符说明句子仍在延续（"……"他说。/ "……"，随后……），不在右引号处断 */
const CONTINUERS = new Set(["，", "、", "：", ",", "。", "！", "？", "；", "…", "!", "?"]);

const MIN_PARA_CHARS = 36; // 短于此的块不拆（诗行/标题/短段）
const MIN_SEG_CHARS = 2; // 断点最小间距，防碎片
const SPLIT_TAGS = new Set(["P", "DIV", "BLOCKQUOTE"]); // 只拆正文块，不动 li/td/标题

/** 从左引号处向后找配对右引号（同类引号可嵌套），找不到返回 -1 */
function findClose(text: string, openIdx: number, open: string, close: string): number {
  let depth = 1;
  for (let i = openIdx + 1; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 吃掉从 pos 开始的连续句末标点与右引号/右括号，返回 run 之后的位置 */
function eatEnderRun(text: string, pos: number, limit: number): number {
  let j = pos;
  while (j < limit && (ENDERS.has(text[j]) || CLOSERS.has(text[j]))) j++;
  return j;
}

/** 计算一段纯文本的断行偏移（"在第 n 个字符之前断行"），纯函数便于测试 */
export function computeBreakOffsets(text: string): number[] {
  const offsets: number[] = [];
  let lastBreak = 0;
  const push = (pos: number) => {
    if (pos - lastBreak >= MIN_SEG_CHARS && pos < text.length) {
      offsets.push(pos);
      lastBreak = pos;
    }
  };

  let i = 0;
  let parenDepth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "（" || ch === "(") {
      parenDepth++;
      i++;
      continue;
    }
    if (parenDepth > 0) {
      if (ch === "）" || ch === ")") parenDepth--;
      i++;
      continue;
    }
    const close = PAIRS[ch] ? findClose(text, i, ch, PAIRS[ch]) : -2;

    if (close >= 0) {
      const content = text.slice(i + 1, close);
      if (DIALOGUE_MARK.test(content)) {
        // 对话：左引号前断行；对话内部的句末标点不断行，整段对话保持连排
        push(i);
        // 右引号后断行；但紧跟延续性标点（，、：或句末标点）时交给句末规则
        const next = text[close + 1];
        if (next !== undefined && !CONTINUERS.has(next) && !CLOSERS.has(next)) push(close + 1);
        i = close + 1;
        continue;
      }
      // 引用词组：整段引号跳过，前后与内部都不断
      i = close + 1;
      continue;
    }

    if (ENDERS.has(ch)) {
      // 句末标点 run（……、！？）连同紧随的右引号/右括号并入本行
      const after = eatEnderRun(text, i, text.length);
      push(after);
      i = after;
      continue;
    }
    i++;
  }
  return offsets;
}

/** 一次收集原始文本节点；插入时反向移动游标，避免每个断点重新遍历整段。 */
function textNodes(block: HTMLElement): { node: Text; start: number }[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let acc = 0;
  let t = walker.nextNode() as Text | null;
  while (t) {
    const len = t.data.length;
    nodes.push({ node: t, start: acc });
    acc += len;
    t = walker.nextNode() as Text | null;
  }
  return nodes;
}

/** 在块内一组字符偏移处插入换行占位（空 span，display:block），从后往前避免偏移失效 */
function insertGaps(block: HTMLElement, offsets: number[]): number {
  const nodes = textNodes(block);
  let index = nodes.length - 1;
  let inserted = 0;
  for (let k = offsets.length - 1; k >= 0; k--) {
    while (index > 0 && nodes[index].start >= offsets[k]) index--;
    if (index < 0) continue;
    const { node, start } = nodes[index];
    const offset = offsets[k] - start;
    const gap = document.createElement("span");
    gap.className = "fr-gap";
    gap.setAttribute("aria-hidden", "true");
    if (offset <= 0) {
      node.parentNode?.insertBefore(gap, node);
    } else if (offset >= node.data.length) {
      node.parentNode?.insertBefore(gap, node.nextSibling);
    } else {
      const rest = node.splitText(offset);
      rest.parentNode?.insertBefore(gap, rest);
    }
    inserted++;
  }
  return inserted;
}

/**
 * 对已编号的块应用友好排版。返回实际拆行的块数。
 * 分割线只加在"自己或前一块发生过拆行"的块之前——原书分段信息不丢，未拆区域不受打扰。
 */
export function applyFriendlyLayout(blocks: HTMLElement[]): number {
  const splitFlags: boolean[] = new Array(blocks.length).fill(false);
  let splitCount = 0;

  blocks.forEach((block, i) => {
    if (!SPLIT_TAGS.has(block.tagName)) return;
    // 短段和单句段也统一左对齐，不由是否实际拆行决定缩进。
    block.classList.add("fr-paragraph");
    const text = block.textContent ?? "";
    if (text.trim().length < MIN_PARA_CHARS) return;
    const offsets = computeBreakOffsets(text);
    if (offsets.length === 0) return;
    if (insertGaps(block, offsets) > 0) {
      splitFlags[i] = true;
      splitCount++;
    }
  });

  for (let i = 1; i < blocks.length; i++) {
    if (splitFlags[i] || splitFlags[i - 1]) {
      // span 而非 div：collectBlocks 把叶子 div 视为块，span 永远不会被计入块编号
      const divider = document.createElement("span");
      divider.className = "fr-divider";
      divider.setAttribute("aria-hidden", "true");
      blocks[i].parentNode?.insertBefore(divider, blocks[i]);
    }
  }
  return splitCount;
}
