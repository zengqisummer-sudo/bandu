import type { Area, StorageProvider } from "./provider";
import { readJsonVia } from "./provider";

// File System Access 实现。两个根目录：状态根（JSON/epub）、产物根（markdown）。

function split(path: string): { dirs: string[]; file: string } {
  const parts = path.split("/").filter(Boolean);
  return { dirs: parts.slice(0, -1), file: parts[parts.length - 1] };
}

async function getDir(
  root: FileSystemDirectoryHandle,
  dirs: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle | null> {
  let cur = root;
  for (const d of dirs) {
    try {
      cur = await cur.getDirectoryHandle(d, { create });
    } catch {
      return null;
    }
  }
  return cur;
}

async function getFileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean
): Promise<FileSystemFileHandle | null> {
  const { dirs, file } = split(path);
  const dir = await getDir(root, dirs, create);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(file, { create });
  } catch {
    return null;
  }
}

async function writeWhole(handle: FileSystemFileHandle, data: string | ArrayBuffer | Blob) {
  const w = await handle.createWritable(); // 默认截断整写
  await w.write(data);
  await w.close();
}

export class FsaProvider implements StorageProvider {
  readonly mode = "fs" as const;

  constructor(
    private stateRoot: FileSystemDirectoryHandle,
    private productRoot: FileSystemDirectoryHandle
  ) {}

  private root(area: Area) {
    return area === "state" ? this.stateRoot : this.productRoot;
  }

  async readText(area: Area, path: string): Promise<string | null> {
    const h = await getFileHandle(this.root(area), path, false);
    if (!h) return null;
    return (await h.getFile()).text();
  }

  readJson<T>(area: Area, path: string): Promise<T | null> {
    return readJsonVia<T>(this, area, path);
  }

  async writeStateJson(path: string, data: unknown): Promise<void> {
    const h = await getFileHandle(this.stateRoot, path, true);
    if (!h) throw new Error(`无法创建文件: ${path}`);
    await writeWhole(h, JSON.stringify(data, null, 2));
  }

  async readBinary(area: Area, path: string): Promise<ArrayBuffer | null> {
    const h = await getFileHandle(this.root(area), path, false);
    if (!h) return null;
    return (await h.getFile()).arrayBuffer();
  }

  async writeStateBinary(path: string, data: ArrayBuffer | Blob): Promise<void> {
    const h = await getFileHandle(this.stateRoot, path, true);
    if (!h) throw new Error(`无法创建文件: ${path}`);
    await writeWhole(h, data);
  }

  /**
   * 产物区常规写入口：keepExistingData + 末尾定位写，不触碰既有字节，
   * 用户在 Obsidian 中的手动编辑绝不会被覆盖（SPEC §1.5-1）。
   */
  async appendMarkdown(path: string, block: string, frontmatterIfNew: string): Promise<void> {
    await this.appendInto(this.productRoot, path, block, frontmatterIfNew);
  }

  /** 状态区追加（调试日志）：与 appendMarkdown 同策略，仅根目录不同 */
  async appendStateMarkdown(path: string, block: string, frontmatterIfNew: string): Promise<void> {
    await this.appendInto(this.stateRoot, path, block, frontmatterIfNew);
  }

  private async appendInto(
    root: FileSystemDirectoryHandle,
    path: string,
    block: string,
    frontmatterIfNew: string
  ): Promise<void> {
    const existing = await getFileHandle(root, path, false);
    if (!existing) {
      const h = await getFileHandle(root, path, true);
      if (!h) throw new Error(`无法创建文件: ${path}`);
      await writeWhole(h, `${frontmatterIfNew}\n${block}\n`);
      return;
    }
    const file = await existing.getFile();
    const size = file.size;
    const w = await existing.createWritable({ keepExistingData: true });
    await w.write({ type: "write", position: size, data: `\n${block}\n` });
    await w.close();
  }

  /**
   * 产物区唯一的改写例外（provider.ts 注释）：读最新内容 → transform 定点改行 → 整写。
   * 紧贴写入时刻重新读文件，把覆盖用户 Obsidian 并发编辑的窗口压到毫秒级。
   */
  async rewriteMarkdown(path: string, transform: (text: string) => string | null): Promise<boolean> {
    const h = await getFileHandle(this.productRoot, path, false);
    if (!h) return false;
    const text = await (await h.getFile()).text();
    const next = transform(text);
    if (next == null || next === text) return next != null;
    await writeWhole(h, next);
    return true;
  }

  async deleteStateDir(prefix: string): Promise<void> {
    const parts = prefix.split("/").filter(Boolean);
    const parent = await getDir(this.stateRoot, parts.slice(0, -1), false);
    if (!parent) return;
    try {
      await parent.removeEntry(parts[parts.length - 1], { recursive: true });
    } catch {
      /* 不存在即视为已删 */
    }
  }

  async listStatePaths(prefix: string): Promise<string[]> {
    const results: string[] = [];
    const startDirs = prefix.split("/").filter(Boolean);
    const start = await getDir(this.stateRoot, startDirs, false);
    if (!start) return results;
    const walk = async (dir: FileSystemDirectoryHandle, base: string) => {
      for await (const entry of dir.values()) {
        const p = base ? `${base}/${entry.name}` : entry.name;
        if (entry.kind === "file") results.push(p);
        else await walk(entry as FileSystemDirectoryHandle, p);
      }
    };
    await walk(start, startDirs.join("/"));
    return results;
  }

  async exists(area: Area, path: string): Promise<boolean> {
    return (await getFileHandle(this.root(area), path, false)) != null;
  }

  /** 仅供 IDB → FS 迁移使用的原样写入（product 区常规写仍只有 append） */
  async writeRaw(area: Area, path: string, data: string | ArrayBuffer): Promise<void> {
    const h = await getFileHandle(this.root(area), path, true);
    if (!h) throw new Error(`无法创建文件: ${path}`);
    await writeWhole(h, data);
  }
}
