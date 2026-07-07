// File System Access API 的补充声明（TS dom lib 未完整覆盖）

interface FileSystemHandle {
  queryPermission(desc?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
  keys(): AsyncIterableIterator<string>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }): Promise<FileSystemDirectoryHandle>;
}
