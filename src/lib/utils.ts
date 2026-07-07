export function genId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  return `${prefix}-${Array.from(rand, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dateStr(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 文件/目录名清洗（Windows 保留字符 + 首尾点空格） */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "");
  return cleaned || "未命名";
}

/** 文本归一化：折叠空白，统一引号，用于模糊匹配 */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[“”"]/g, "")
    .replace(/[‘’']/g, "")
    .replace(/[，,]/g, "，");
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;
  return (...args: A) => {
    lastArgs = args;
    const now = Date.now();
    const run = () => {
      last = Date.now();
      timer = null;
      fn(...(lastArgs as A));
    };
    if (now - last >= ms) run();
    else if (!timer) timer = setTimeout(run, ms - (now - last));
  };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
