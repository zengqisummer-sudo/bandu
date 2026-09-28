// 摘录标签：Obsidian 语法（#tag，/ 分层嵌套），存储不带 #，展示时加 #。
// 全局标签词表存 localStorage（跨书复用，配合 TagInput 联想）。

const VOCAB_KEY = "aireader.tags.v1";

/** Obsidian 合法字符：任意语言字母、数字、下划线、连字符、/（嵌套） */
const TAG_CHARS = /^[\p{L}\p{N}_/-]+$/u;

/**
 * 归一化用户输入：去掉前导 #、首尾空白与多余的 /。
 * 返回 null 表示不是合法标签（含非法字符 / 纯数字 / 空）。
 */
export function normalizeTag(raw: string): string | null {
  const t = raw.trim().replace(/^#+/, "").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (!t || !TAG_CHARS.test(t)) return null;
  // Obsidian 规则：至少含一个非数字字符（#2024 非法，#y2024 合法）
  if (!/[^\d/]/.test(t)) return null;
  return t;
}

/** 输入过程中的字符过滤（放行合法字符与 #，其余丢弃） */
export function sanitizeTagTyping(s: string): string {
  return [...s].filter((ch) => ch === "#" || /[\p{L}\p{N}_/-]/u.test(ch)).join("");
}

/** md 中的标签行："#a #b/c"。识别用：整行仅由 #tag 空格分隔构成 */
export function tagLine(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

export function isTagLine(line: string): boolean {
  const s = line.trim();
  if (!s.startsWith("#")) return false;
  return s.split(/\s+/).every((w) => w.startsWith("#") && normalizeTag(w) != null);
}

// ---- 全局标签词表（localStorage，跨书复用） ----

interface VocabEntry {
  n: number; // 使用次数
  t: number; // 最近使用（epoch ms）
}

function readVocab(): Record<string, VocabEntry> {
  try {
    const raw = localStorage.getItem(VOCAB_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return typeof v === "object" && v ? v : {};
  } catch {
    return {};
  }
}

/** 记录一批标签的使用（去重后计数+1） */
export function recordTagUse(tags: string[]): void {
  if (!tags.length) return;
  const vocab = readVocab();
  const now = Date.now();
  for (const t of new Set(tags)) {
    const e = vocab[t];
    vocab[t] = { n: (e?.n ?? 0) + 1, t: now };
  }
  try {
    localStorage.setItem(VOCAB_KEY, JSON.stringify(vocab));
  } catch {
    /* 配额满等，联想少几个词而已 */
  }
}

/**
 * 联想候选：全局词表 ∪ 本书已用标签，按输入前缀过滤后排序。
 * 匹配规则：标签整体或任一 / 分段以 query 开头（不区分大小写）；query 为空给出全部（按热度）。
 */
export function suggestTags(query: string, bookTags: string[], exclude: string[]): string[] {
  const vocab = readVocab();
  const all = new Map<string, VocabEntry>();
  for (const [t, e] of Object.entries(vocab)) all.set(t, e);
  for (const t of bookTags) if (!all.has(t)) all.set(t, { n: 1, t: 0 });
  for (const t of exclude) all.delete(t);

  const q = query.replace(/^#+/, "").toLowerCase();
  const scored: { tag: string; starts: boolean; e: VocabEntry }[] = [];
  for (const [tag, e] of all) {
    const lower = tag.toLowerCase();
    if (q) {
      const starts = lower.startsWith(q) || lower.split("/").some((seg) => seg.startsWith(q));
      const contains = lower.includes(q);
      if (!starts && !contains) continue;
      scored.push({ tag, starts, e });
    } else {
      scored.push({ tag, starts: true, e });
    }
  }
  scored.sort((a, b) => Number(b.starts) - Number(a.starts) || b.e.n - a.e.n || b.e.t - a.e.t || a.tag.localeCompare(b.tag));
  return scored.slice(0, 8).map((s) => s.tag);
}
