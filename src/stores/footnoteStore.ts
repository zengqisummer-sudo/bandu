import { create } from "zustand";
import type { Anchor, BookMeta, Footnote, FootnotesFile, HintsFile } from "../types/models";
import { storage } from "../services/storage";
import { paths } from "../services/storage/paths";
import { genId, nowIso } from "../lib/utils";
import { useReaderStore } from "./readerStore";
import { useSettingsStore } from "./settingsStore";
import { beforeWindow } from "../services/ai/context";
import { effectivePromptSet } from "../services/ai/prompts";
import { friendlyAiError, resolveAiConfig, streamChat } from "../services/ai/client";
import { fetchBookGuide } from "../services/ai/bookGuide";
import { toast, useUiStore } from "./uiStore";

const filePath = paths.footnotes;
let loadVersion = 0;
let guideAbort: AbortController | null = null;
let writes: Promise<unknown> = Promise.resolve();
function queuedWrite(bookId: string, file: FootnotesFile) {
  const provider = storage();
  const next = writes.catch(() => {}).then(() => provider.writeStateJson(filePath(bookId), file));
  writes = next;
  return next;
}
interface State {
  bookId: string | null; items: Footnote[]; bookGuide: string; busy: boolean; ready: boolean;
  editingId: string | null; guideError: string;
  load(book: BookMeta): Promise<void>; reset(): void;
  save(note: Footnote): Promise<boolean>; remove(id: string): Promise<void>;
  edit(id: string | null): void; generateGuide(): Promise<void>;
}
export const useFootnoteStore = create<State>((set, get) => ({
  bookId: null, items: [], bookGuide: "", busy: false, ready: false, editingId: null, guideError: "",
  async load(book) {
    guideAbort?.abort();
    const v = ++loadVersion;
    set({ bookId: book.id, items: [], bookGuide: "", ready: false, editingId: null, guideError: "", busy: false });
    try {
      const saved = await storage().readJson<FootnotesFile>("state", filePath(book.id));
      let items = saved?.items;
      // First 2.0 open: preserve legacy inline notes. Block hints stay with chapter guides.
      if (!items) {
        items = [];
        for (const path of await storage().listStatePaths(`books/${book.id}/hints`)) {
          if (!path.endsWith(".json")) continue;
          const hints = await storage().readJson<HintsFile>("state", path);
          for (const h of hints?.hints ?? []) if (h.kind === "inline") items.push({ id: h.id, spine: hints!.metadata.spine, target: h.target, text: h.text, sync: false, createdAt: hints!.metadata.generatedAt });
        }
        await queuedWrite(book.id, { version: 1, items });
      }
      if (v === loadVersion) set({ items, bookGuide: saved?.bookGuide ?? "", ready: true });
    } catch (e) { if (v === loadVersion) toast("error", `注释读取失败：${friendlyAiError(e)}`); }
  },
  reset() { guideAbort?.abort(); ++loadVersion; set({ bookId: null, items: [], bookGuide: "", ready: false, busy: false, editingId: null }); },
  async save(note) {
    const { bookId, items, bookGuide, ready } = get();
    const book = useReaderStore.getState().book;
    if (!ready || !bookId || book?.id !== bookId) { toast("error", "注释尚未读取完成，请稍后保存"); return false; }
    const next = items.some(x => x.id === note.id) ? items.map(x => x.id === note.id ? note : x) : [...items, note];
    set({ items: next });
    try { await queuedWrite(bookId, { version: 1, items: next, bookGuide }); }
    catch (e) { if (get().items === next) set({ items }); toast("error", `注释保存失败：${friendlyAiError(e)}`); return false; }
    try { await storage().appendMarkdown(paths.productNotes(book.productDir), `\n---\n\n## 随文注释${note.sync ? "（全书共享）" : ""}\n<!-- footnote ${note.id} -->\n> ${note.target.exact.replace(/\n/g, "\n> ")}\n\n${note.text}\n`, "# 阅读注释\n"); }
    catch (e) { toast("error", `注释已保存，Markdown 追加失败：${friendlyAiError(e)}`); }
    return true;
  },
  async remove(id) {
    const { bookId, bookGuide, items } = get(); if (!bookId) return;
    const next = items.filter(x => x.id !== id); set({ items: next });
    try { await queuedWrite(bookId, { version: 1, items: next, bookGuide }); }
    catch (e) { if (get().items === next) set({ items }); toast("error", friendlyAiError(e)); }
  },
  edit(id) { set({ editingId: id }); useUiStore.getState().setPanel(true, "annos"); if (id) useReaderStore.getState().setFocus(id, "text"); },
  async generateGuide() {
    const book = useReaderStore.getState().book; if (!book || get().busy || !get().ready) return;
    const v = loadVersion;
    set({ busy: true, guideError: "" });
    guideAbort = new AbortController();
    try {
      const guide = await fetchBookGuide(book, useSettingsStore.getState().settings, guideAbort.signal);
      if (v !== loadVersion) return;
      const previous = get().bookGuide;
      set({ bookGuide: guide });
      try { await queuedWrite(book.id, { version: 1, items: get().items, bookGuide: guide }); }
      catch (e) { if (v === loadVersion) set({ bookGuide: previous }); throw e; }
      await storage().appendMarkdown(paths.productNotes(book.productDir), `\n---\n\n## 全书导读\n\n${guide}\n`, "# 阅读注释\n");
    } catch (e) { if (v === loadVersion) set({ guideError: friendlyAiError(e) }); }
    finally { if (v === loadVersion) set({ busy: false }); }
  },
}));

export function newFootnote(anchor: Anchor): Footnote {
  return { id: genId("fn"), spine: useReaderStore.getState().chapter!.spine, target: { exact: anchor.quote, prefix: anchor.prefix, suffix: anchor.suffix }, text: "", sync: false, createdAt: nowIso() };
}
export async function explainFootnote(anchor: Anchor, signal: AbortSignal): Promise<string> {
  const { book, bookId, chapter } = useReaderStore.getState();
  const { settings, prompts } = useSettingsStore.getState();
  const cfg = resolveAiConfig(settings);
  if (!book || !bookId || !chapter || !cfg) throw new Error("请先配置 AI 提供商与 API key");
  const win = await beforeWindow(bookId, { spine: chapter.spine, para: anchor.para, offset: anchor.start }, settings.contextChars);
  const prompt = effectivePromptSet(prompts, book.contentType).footnote!;
  let text = "";
  for await (const c of streamChat(cfg, { system: prompt + "\n仅依据所给前文与公共背景知识，不揭示后文。", messages: [{ role: "user", content: `书名：${book.title}\n前文：${win}\n请注释：${anchor.quote}` }], maxTokens: 1024, signal })) text += c;
  if (!text.trim()) throw new Error("模型没有返回内容");
  return text.trim();
}
