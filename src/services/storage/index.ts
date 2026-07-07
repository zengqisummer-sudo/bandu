import type { StorageProvider } from "./provider";
import { FsaProvider } from "./fsa";
import { IdbProvider } from "./idbStorage";
import { loadHandles } from "./handles";

export type StorageMode = "fs" | "idb";

const MODE_KEY = "aireader.mode";

let current: StorageProvider | null = null;

export function getStorageMode(): StorageMode | null {
  const m = localStorage.getItem(MODE_KEY);
  return m === "fs" || m === "idb" ? m : null;
}

export function setStorageMode(mode: StorageMode) {
  localStorage.setItem(MODE_KEY, mode);
}

export function setProvider(p: StorageProvider | null) {
  current = p;
}

/** 未就绪时抛错——调用方（stores）负责在 UI 层拦住未就绪状态 */
export function storage(): StorageProvider {
  if (!current) throw new Error("存储尚未就绪");
  return current;
}

export function storageReady(): boolean {
  return current != null;
}

export function makeIdbProvider(): IdbProvider {
  return new IdbProvider();
}

export async function makeFsaProviderFromSaved(): Promise<FsaProvider | null> {
  const { state, product } = await loadHandles();
  if (!state || !product) return null;
  return new FsaProvider(state, product);
}

/** 浏览器模式数据一键写出到文件夹（IDB → FS 迁移，SPEC §1.6）。
 *  目标已存在的文件一律跳过——绝不覆盖文件夹里既有内容（尤其产物 md）。 */
export async function migrateIdbToFs(fsa: FsaProvider): Promise<{ written: number; skipped: number }> {
  const idb = new IdbProvider();
  const files = await idb.listAll();
  let written = 0;
  let skipped = 0;
  for (const f of files) {
    if (await fsa.exists(f.area, f.path)) {
      skipped++;
      continue;
    }
    await fsa.writeRaw(f.area, f.path, f.data);
    written++;
  }
  return { written, skipped };
}
