import { highlightText } from "@apache-annotator/dom";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { HintMatch } from "./match";
import { noteTypeClass, noteTypeLabel } from "./noteTypes";

/**
 * 渲染时合并（ANNOTATION_SPEC §5）：把已匹配的 hints 注入章节 DOM。
 * - inline：文本节点切分与包裹交给库的 highlightText（mark 元素）
 * - block：找到锚点所在块（data-para），按 placement 插入 callout 兄弟节点
 * 注入元素一律不带 data-para —— 块编号（旧锚点体系）不受影响，且绝不重跑 numberBlocks。
 *
 * 必须按文档序**倒序**注入：DOM 变动只发生在尚未处理的 Range 之后，
 * 已收集的前方 Range 不会被文本节点切分/移动破坏。
 */

function inlineMd(text: string): string {
  return DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string);
}

function buildCallout(m: HintMatch): HTMLElement {
  const el = document.createElement("aside");
  el.className = `hint-callout hint-nt-${noteTypeClass(m.hint.note_type)}`;
  el.dataset.hintId = m.hint.id;
  const label = document.createElement("span");
  label.className = "hint-callout-label";
  label.textContent = `✦ ${noteTypeLabel(m.hint.note_type)}`;
  const body = document.createElement("span");
  body.className = "hint-callout-body";
  body.innerHTML = inlineMd(m.hint.text);
  el.append(label, body);
  return el;
}

/** 锚点所在的块级元素（优先 data-para 编号块），兜底到 root 直接子元素 */
function blockOf(root: HTMLElement, range: Range): HTMLElement {
  const start = range.startContainer;
  const el = start.nodeType === Node.ELEMENT_NODE ? (start as HTMLElement) : start.parentElement;
  if (!el || el === root) return root;
  const block = el.closest<HTMLElement>("[data-para]");
  if (block && root.contains(block) && block !== root) return block;
  let cur: HTMLElement = el;
  while (cur.parentElement && cur.parentElement !== root) cur = cur.parentElement;
  return root.contains(cur) ? cur : root;
}

function insertCallout(root: HTMLElement, m: HintMatch): void {
  const block = blockOf(root, m.range);
  const el = buildCallout(m);
  if (block === root) {
    if (m.hint.placement === "before") root.prepend(el);
    else root.append(el);
  } else if (m.hint.placement === "after") {
    block.after(el);
  } else {
    block.before(el);
  }
}

function wrapInline(m: HintMatch): void {
  highlightText(m.range, "mark", {
    class: `hint-mark hint-nt-${noteTypeClass(m.hint.note_type)}`,
    "data-hint-id": m.hint.id,
  });
}

/** 把匹配结果注入 DOM。返回注入失败（极端 DOM 状况）的 hint id 列表 */
export function injectHints(root: HTMLElement, matches: HintMatch[]): string[] {
  const failed: string[] = [];
  const sorted = [...matches].sort((a, b) => b.range.compareBoundaryPoints(Range.START_TO_START, a.range));
  for (const m of sorted) {
    try {
      if (m.hint.kind === "inline") wrapInline(m);
      else insertCallout(root, m);
    } catch (e) {
      failed.push(m.hint.id);
      console.warn("hint 注入失败", m.hint.id, e);
    }
  }
  return failed;
}

/**
 * 幂等清理全部注入物（重新注入 / 隐藏切换 / 重新生成前调用）。
 * unwrap 是纯 DOM 节点操作；normalize 合并被切分的文本节点，
 * 之后旧式高亮会由 hintPass 触发重新解析注册，不受影响。
 */
export function removeInjectedHints(root: HTMLElement): void {
  root.querySelectorAll(".hint-callout").forEach((el) => el.remove());
  root.querySelectorAll("mark.hint-mark").forEach((markEl) => {
    const parent = markEl.parentNode;
    if (!parent) return;
    while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
    markEl.remove();
  });
  root.normalize();
}
