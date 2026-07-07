import { idbDel, idbGet, idbKeys, idbSet } from "../../lib/idb";
import type { Area, StorageProvider } from "./provider";
import { readJsonVia } from "./provider";

// 浏览器模式（降级）：逻辑路径映射为 IndexedDB "files" store 的 KV。
// key = "state:books/…" / "product:城堡/注释.md"

const key = (area: Area, path: string) => `${area}:${path}`;

export class IdbProvider implements StorageProvider {
  readonly mode = "idb" as const;

  async readText(area: Area, path: string): Promise<string | null> {
    const v = await idbGet<string | ArrayBuffer>("files", key(area, path));
    return typeof v === "string" ? v : null;
  }

  readJson<T>(area: Area, path: string): Promise<T | null> {
    return readJsonVia<T>(this, area, path);
  }

  async writeStateJson(path: string, data: unknown): Promise<void> {
    await idbSet("files", key("state", path), JSON.stringify(data, null, 2));
  }

  async readBinary(area: Area, path: string): Promise<ArrayBuffer | null> {
    const v = await idbGet<string | ArrayBuffer>("files", key(area, path));
    return v instanceof ArrayBuffer ? v : null;
  }

  async writeStateBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;
    await idbSet("files", key("state", path), buf);
  }

  async appendMarkdown(path: string, block: string, frontmatterIfNew: string): Promise<void> {
    const k = key("product", path);
    const existing = await idbGet<string>("files", k);
    const next = existing == null ? `${frontmatterIfNew}\n${block}\n` : `${existing}\n${block}\n`;
    await idbSet("files", k, next);
  }

  async deleteStateDir(prefix: string): Promise<void> {
    const keys = await idbKeys("files", key("state", prefix));
    await Promise.all(keys.map((k) => idbDel("files", k)));
  }

  async listStatePaths(prefix: string): Promise<string[]> {
    const keys = await idbKeys("files", key("state", prefix));
    return keys.map((k) => k.slice("state:".length));
  }

  /** 迁移用：枚举全部虚拟文件 */
  async listAll(): Promise<{ area: Area; path: string; data: string | ArrayBuffer }[]> {
    const keys = await idbKeys("files");
    const out: { area: Area; path: string; data: string | ArrayBuffer }[] = [];
    for (const k of keys) {
      const idx = k.indexOf(":");
      const area = k.slice(0, idx) as Area;
      const path = k.slice(idx + 1);
      const data = await idbGet<string | ArrayBuffer>("files", k);
      if (data != null) out.push({ area, path, data });
    }
    return out;
  }
}
