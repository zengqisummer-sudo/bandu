export type Area = "state" | "product";

/**
 * 存储抽象。关键约束（SPEC §1.5）：
 * - product 区没有整写接口，常规写入口是 appendMarkdown（只追加，绝不覆盖既有字节）
 * - 唯一例外 rewriteMarkdown：定点小改（如摘录标签行），读最新内容→变换→整写，
 *   变换必须只动目标行；除此之外任何"读出改写回"仍然禁止
 * - state 区 JSON 可整写，应用是唯一写者
 */
export interface StorageProvider {
  readonly mode: "fs" | "idb";
  readText(area: Area, path: string): Promise<string | null>;
  readJson<T>(area: Area, path: string): Promise<T | null>;
  writeStateJson(path: string, data: unknown): Promise<void>;
  readBinary(area: Area, path: string): Promise<ArrayBuffer | null>;
  writeStateBinary(path: string, data: ArrayBuffer | Blob): Promise<void>;
  /** 追加 markdown 块到产物文件；文件不存在时先写 frontmatter 再写块 */
  appendMarkdown(path: string, block: string, frontmatterIfNew: string): Promise<void>;
  /** 同 appendMarkdown，但写入状态区（如调试用 AI 请求日志）；只追加，不覆盖既有字节 */
  appendStateMarkdown(path: string, block: string, frontmatterIfNew: string): Promise<void>;
  /**
   * 产物文件定点改写（见上方例外说明）。transform 收到写入前一刻的最新全文，
   * 返回改后的全文；返回 null 表示放弃（未找到目标等）。文件不存在返回 false。
   */
  rewriteMarkdown(path: string, transform: (text: string) => string | null): Promise<boolean>;
  deleteStateDir(prefix: string): Promise<void>;
  /** 列出 state 区某前缀下的所有文件路径（用于书架枚举与迁移） */
  listStatePaths(prefix: string): Promise<string[]>;
}

export async function readJsonVia<T>(p: StorageProvider, area: Area, path: string): Promise<T | null> {
  const text = await p.readText(area, path);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(`JSON 解析失败: ${area}/${path}`);
    return null;
  }
}
