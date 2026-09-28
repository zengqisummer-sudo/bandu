import type { Hint, HintKind, HintPlacement } from "../../types/models";

/**
 * AI 输出 → Hint[]（ANNOTATION_SPEC §9.5）。
 * 容错优先：剥围栏 → 整体 JSON.parse → 失败则按顶层对象逐个提取
 * （流式截断只损失最后一条，不让整批作废）。
 * id / file 由这里分配，AI 不产 id。
 */

const MAX_HINTS = 40;
const NOTE_TYPES_BLOCKISH = new Set(["direction", "background"]);

function rand4(): string {
  const b = crypto.getRandomValues(new Uint8Array(2));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** 去掉 markdown 代码围栏行（模型偶尔无视"不要围栏"的指令）与推理模型内联的 <think> 块 */
function stripFences(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```[a-zA-Z]*\s*$/gm, "");
}

// 字段别名兜底：契约要求 target.exact + text，但模型常自作主张换字段名/拍平结构。
// 解析层尽量收编，别让整批注释因命名分歧作废（失败原文另有诊断展示）。
const TEXT_KEYS = ["text", "note", "content", "comment", "annotation", "explanation"];
const EXACT_KEYS = ["exact", "anchor_text", "anchorText", "quote", "phrase", "span", "target_text", "anchor"];

function pickString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 顶层（深度 1）对象逐个提取，字符串感知，截断的尾对象自然丢弃 */
function extractObjects(s: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(s.slice(start, i + 1)));
        } catch {
          /* 单条坏对象跳过 */
        }
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

function asItems(raw: string): unknown[] {
  const text = stripFences(raw);
  const from = text.indexOf("[");
  const to = text.lastIndexOf("]");
  if (from >= 0 && to > from) {
    try {
      const arr = JSON.parse(text.slice(from, to + 1));
      if (Array.isArray(arr)) return arr;
    } catch {
      /* 落到逐对象提取 */
    }
  }
  return extractObjects(from >= 0 ? text.slice(from) : text);
}

function coerce(item: unknown, index: number, ctx: { spine: number; file: string }): Hint | null {
  if (typeof item !== "object" || item === null) return null;
  const o = item as Record<string, unknown>;
  const t = (typeof o.target === "object" && o.target !== null ? o.target : {}) as Record<string, unknown>;

  // 锚点原文：target.exact → target 内别名 → target 本身是字符串 → 顶层拍平/别名
  const targetStr = typeof o.target === "string" ? o.target.trim() : "";
  const exact = pickString(t, EXACT_KEYS) || targetStr || pickString(o, EXACT_KEYS);
  // 注释正文：text → 顶层别名 → target 内误放
  const text = pickString(o, TEXT_KEYS) || pickString(t, TEXT_KEYS);
  if (!exact || exact.length > 300 || !text || text === exact) return null;

  const note_type =
    typeof o.note_type === "string" && o.note_type.trim() ? o.note_type.trim().toLowerCase() : "direction";
  const kind: HintKind =
    o.kind === "block" || o.kind === "inline"
      ? o.kind
      : NOTE_TYPES_BLOCKISH.has(note_type)
        ? "block"
        : "inline";
  const placement: HintPlacement =
    o.placement === "before" || o.placement === "after" ? o.placement : kind === "block" ? "before" : "after";

  const rawPrefix = typeof t.prefix === "string" ? t.prefix : typeof o.prefix === "string" ? o.prefix : "";
  const rawSuffix = typeof t.suffix === "string" ? t.suffix : typeof o.suffix === "string" ? o.suffix : "";
  const prefix = rawPrefix.trim() ? rawPrefix.slice(-60) : undefined;
  const suffix = rawSuffix.trim() ? rawSuffix.slice(0, 60) : undefined;
  const occRaw = Number(t.occurrence);
  const occurrence = Number.isInteger(occRaw) && occRaw >= 1 ? occRaw : undefined;

  return {
    id: `s${ctx.spine}-h${index + 1}-${rand4()}`,
    file: ctx.file,
    kind,
    placement,
    target: { exact, prefix, suffix, occurrence },
    text: text.slice(0, 500),
    note_type,
  };
}

export function parseHintsOutput(raw: string, ctx: { spine: number; file: string }): Hint[] {
  const hints: Hint[] = [];
  for (const item of asItems(raw)) {
    const h = coerce(item, hints.length, ctx);
    if (h) hints.push(h);
    if (hints.length >= MAX_HINTS) break;
  }
  return hints;
}
