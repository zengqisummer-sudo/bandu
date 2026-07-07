import { idbGet, idbSet } from "../../lib/idb";

// 目录句柄持久化在 IndexedDB（句柄本身无法存文件）。
// 刷新后需 queryPermission / requestPermission 恢复访问。

const KEY = "dir-handles";

export interface DirHandles {
  state?: FileSystemDirectoryHandle;
  product?: FileSystemDirectoryHandle;
}

export async function saveHandles(h: DirHandles): Promise<void> {
  await idbSet("kv", KEY, h);
}

export async function loadHandles(): Promise<DirHandles> {
  return (await idbGet<DirHandles>("kv", KEY)) ?? {};
}

/** 静默检查（boot 时用，不能触发弹窗） */
export async function hasPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  return (await h.queryPermission({ mode: "readwrite" })) === "granted";
}

/** 需要用户手势的场景调用 */
export async function requestPermission(h: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasPermission(h)) return true;
  return (await h.requestPermission({ mode: "readwrite" })) === "granted";
}

export function fsaSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory(id: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ id, mode: "readwrite" });
  } catch {
    return null; // 用户取消
  }
}
