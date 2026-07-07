import { create } from "zustand";
import type { BookMeta, ContentType } from "../types/models";
import { storage, storageReady } from "../services/storage";
import { paths } from "../services/storage/paths";
import { importEpub } from "../services/epub/import";
import { closeEpub } from "../services/epub/parse";
import { toast } from "./uiStore";

interface LibraryState {
  books: BookMeta[];
  covers: Record<string, string>; // bookId → blob URL
  loading: boolean;
  refresh(): Promise<void>;
  importBook(file: File, contentType: ContentType): Promise<BookMeta | null>;
  removeBook(id: string): Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  books: [],
  covers: {},
  loading: false,

  async refresh() {
    if (!storageReady()) return;
    set({ loading: true });
    try {
      const files = await storage().listStatePaths("books");
      const metaPaths = files.filter((p) => p.endsWith("/book.json"));
      const books: BookMeta[] = [];
      for (const p of metaPaths) {
        const meta = await storage().readJson<BookMeta>("state", p);
        if (meta) books.push(meta);
      }
      books.sort((a, b) => b.importedAt.localeCompare(a.importedAt));

      const covers: Record<string, string> = {};
      for (const b of books) {
        const prev = get().covers[b.id];
        if (prev) {
          covers[b.id] = prev; // 复用已有 blob URL
          continue;
        }
        if (b.coverFile) {
          const buf = await storage().readBinary("state", paths.cover(b.id, b.coverFile));
          if (buf) covers[b.id] = URL.createObjectURL(new Blob([buf]));
        }
      }
      set({ books, covers, loading: false });
    } catch (e) {
      console.error(e);
      set({ loading: false });
      toast("error", "读取书架失败");
    }
  },

  async importBook(file, contentType) {
    try {
      const existingDirs = get().books.map((b) => b.productDir);
      const { meta, already } = await importEpub(file, contentType, existingDirs);
      if (already) toast("info", `《${meta.title}》已在书架上`);
      else toast("success", `已导入《${meta.title}》`);
      await get().refresh();
      return meta;
    } catch (e) {
      console.error(e);
      toast("error", e instanceof Error ? e.message : "导入失败");
      return null;
    }
  },

  async removeBook(id) {
    closeEpub(id);
    await storage().deleteStateDir(paths.bookDir(id));
    const cover = get().covers[id];
    if (cover) URL.revokeObjectURL(cover);
    toast("info", "已从书架移除（阅读产物 markdown 保留）");
    await get().refresh();
  },
}));
