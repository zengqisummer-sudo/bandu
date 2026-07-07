export type Area = "state" | "product";

/**
 * 存储抽象。关键约束（SPEC §1.5）：
 * - product 区没有整写接口，唯一写入口是 appendMarkdown（只追加，绝不覆盖既有字节）
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
