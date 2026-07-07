import { create } from "zustand";
import type { Anchor, Annotation, AnnotationsFile, BookMeta, Excerpt, ExcerptsFile, Progress } from "../types/models";
import { storage } from "../services/storage";
import { paths } from "../services/storage/paths";
import { chapterText, closeEpub, loadChapter } from "../services/epub/parse";
import { beforeWindow, chapterFullText, chapterLabelFor, readChapterTitles } from "../services/ai/context";
import { buildChapterNoteRequest, buildPassageRequest, effectivePromptSet } from "../services/ai/prompts";
import { friendlyAiError, resolveAiConfig, streamChat } from "../services/ai/client";
import { appendAnnotationMd, appendExcerptMd } from "../services/product/markdown";
import { locateQuote } from "../services/import/kindle";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./uiStore";
import { genId, nowIso, truncate } from "../lib/utils";

interface ChapterState {
  spine: number;
  html: string;
  href: string;
  paras: string[];
}

const defaultProgress = (): Progress => ({
  version: 1,
  spine: 0,
  anchor: { para: 0 },
  percent: 0,
  updatedAt: nowIso(),
});

// 章节导读并发防抖 & 进度写盘节流（模块级，不进 store）
const noteInflight = new Set<string>();
let progressTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleProgressWrite(bookId: string, progress: Progress) {
  if (progressTimer) clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    storage()
      .writeStateJson(paths.progress(bookId), progress)
      .catch((e) => console.warn("进度写入失败", e));
  }, 1200);
}

function flushProgressWrite(bookId: string, progress: Progress) {
  if (progressTimer) clearTimeout(progressTimer);
  progressTimer = null;
  storage()
    .writeStateJson(paths.progress(bookId), progress)
    .catch(() => {});
}

interface ReaderState {
  bookId: string | null;
  book: BookMeta | null;
  chapter: ChapterState | null;
  chapterLoading: boolean;
  progress: Progress;
  annotations: Annotation[];
  excerpts: Excerpt[];
  /** 生成中的注释内容（id → 已流出的文本） */
  streaming: Record<string, string>;
  focus: { id: string; source: "text" | "panel"; nonce: number } | null;
  /** 章节渲染完成后需恢复的滚动块 */
  pendingScrollPara: number | null;

  openBook(id: string): Promise<boolean>;
  closeBook(): void;
  openSpine(spine: number, para?: number): Promise<void>;
  clearPendingScroll(): void;
  reportPosition(para: number): void;
  deepDive(anchor: Anchor): Promise<void>;
  generateChapterNote(force?: boolean): Promise<void>;
  addExcerptFromAnchor(anchor: Anchor): Promise<void>;
  importExcerptQuotes(quotes: string[], source: "kindle" | "text"): Promise<{ located: number; unlocated: number }>;
  removeAnnotation(id: string): Promise<void>;
  removeExcerpt(id: string): Promise<void>;
  setFocus(id: string, source: "text" | "panel"): void;
}

export const useReaderStore = create<ReaderState>((set, get) => {
  async function saveAnnotations() {
    const { bookId, annotations } = get();
    if (!bookId) return;
    const file: AnnotationsFile = { version: 1, items: annotations };
    await storage().writeStateJson(paths.annotations(bookId), file);
  }

  async function saveExcerpts() {
    const { bookId, excerpts } = get();
    if (!bookId) return;
    const file: ExcerptsFile = { version: 1, items: excerpts };
    await storage().writeStateJson(paths.excerpts(bookId), file);
  }

  /** 注释生成公共流程：乐观插入 → 流式 → 落 JSON + 追加 md */
  async function runAnnotation(anno: Annotation, req: { system: string; messages: { role: "user" | "assistant"; content: string }[] }) {
    const settings = useSettingsStore.getState().settings;
    const cfg = resolveAiConfig(settings);
    if (!cfg) {
      toast("error", "请先在设置中配置 AI 提供商与 API key");
      return;
    }
    set((s) => ({
      annotations: [...s.annotations, anno],
      streaming: { ...s.streaming, [anno.id]: "" },
    }));
    try {
      let acc = "";
      for await (const chunk of streamChat(cfg, { ...req, maxTokens: 1024 })) {
        acc += chunk;
        set((s) => ({ streaming: { ...s.streaming, [anno.id]: acc } }));
      }
      const done = { ...anno, content: acc.trim() };
      if (!done.content) throw new Error("模型没有返回内容");
      set((s) => ({ annotations: s.annotations.map((a) => (a.id === anno.id ? done : a)) }));
      await saveAnnotations();
      const book = get().book;
      if (book) await appendAnnotationMd(book, done);
    } catch (e) {
      set((s) => ({ annotations: s.annotations.filter((a) => a.id !== anno.id) }));
      toast("error", `注释生成失败：${friendlyAiError(e)}`);
    } finally {
      set((s) => {
        const { [anno.id]: _drop, ...rest } = s.streaming;
        return { streaming: rest };
      });
    }
  }

  return {
    bookId: null,
    book: null,
    chapter: null,
    chapterLoading: false,
    progress: defaultProgress(),
    annotations: [],
    excerpts: [],
    streaming: {},
    focus: null,
    pendingScrollPara: null,

    async openBook(id) {
      const book = await storage().readJson<BookMeta>("state", paths.book(id));
      if (!book) {
        toast("error", "找不到这本书");
        return false;
      }
      const progress = (await storage().readJson<Progress>("state", paths.progress(id))) ?? defaultProgress();
      const annos = await storage().readJson<AnnotationsFile>("state", paths.annotations(id));
      const excerpts = await storage().readJson<ExcerptsFile>("state", paths.excerpts(id));
      set({
        bookId: id,
        book,
        progress,
        annotations: annos?.items ?? [],
        excerpts: excerpts?.items ?? [],
        chapter: null,
        streaming: {},
        focus: null,
      });
      await get().openSpine(Math.min(progress.spine, book.spineLength - 1), progress.anchor.para);
      return true;
    },

    closeBook() {
      const { bookId, progress } = get();
      if (bookId) {
        flushProgressWrite(bookId, progress);
        closeEpub(bookId);
      }
      set({
        bookId: null,
        book: null,
        chapter: null,
        annotations: [],
        excerpts: [],
        streaming: {},
        focus: null,
        progress: defaultProgress(),
      });
    },

    async openSpine(spine, para = 0) {
      const { bookId, book } = get();
      if (!bookId || !book) return;
      const target = Math.max(0, Math.min(spine, book.spineLength - 1));
      set({ chapterLoading: true });
      try {
        const c = await loadChapter(bookId, target);
        const progress: Progress = {
          version: 1,
          spine: target,
          anchor: { para },
          percent: Math.min(1, (target + (para + 1) / Math.max(c.paras.length, 1)) / book.spineLength),
          updatedAt: nowIso(),
        };
        set({
          chapter: { spine: target, html: c.html, href: c.href, paras: c.paras },
          chapterLoading: false,
          pendingScrollPara: para,
          progress,
        });
        scheduleProgressWrite(bookId, progress);
        void get().generateChapterNote(false);
      } catch (e) {
        set({ chapterLoading: false });
        toast("error", e instanceof Error ? e.message : "章节加载失败");
      }
    },

    clearPendingScroll() {
      set({ pendingScrollPara: null });
    },

    reportPosition(para) {
      const { bookId, book, chapter, progress } = get();
      if (!bookId || !book || !chapter) return;
      if (progress.anchor.para === para && progress.spine === chapter.spine) return;
      const next: Progress = {
        version: 1,
        spine: chapter.spine,
        anchor: { para },
        percent: Math.min(1, (chapter.spine + (para + 1) / Math.max(chapter.paras.length, 1)) / book.spineLength),
        updatedAt: nowIso(),
      };
      set({ progress: next });
      scheduleProgressWrite(bookId, next);
    },

    async deepDive(anchor) {
      const { bookId, book, chapter } = get();
      if (!bookId || !book || !chapter) return;
      const settings = useSettingsStore.getState().settings;
      const prompts = useSettingsStore.getState().prompts;
      const anno: Annotation = {
        id: genId("a"),
        kind: "passage",
        spine: chapter.spine,
        anchor,
        content: "",
        createdAt: nowIso(),
      };
      // 防剧透边界：选中处（SPEC §4.3）
      const win = await beforeWindow(
        bookId,
        { spine: chapter.spine, para: anchor.para, offset: anchor.start },
        settings.contextChars
      );
      const req = buildPassageRequest({
        book,
        chapterLabel: chapterLabelFor(book, chapter.spine),
        beforeWindow: win,
        quote: anchor.quote,
        promptSet: effectivePromptSet(prompts, book.contentType),
      });
      await runAnnotation(anno, req);
    },

    async generateChapterNote(force = false) {
      const { bookId, book, chapter, annotations } = get();
      if (!bookId || !book || !chapter) return;
      const settings = useSettingsStore.getState().settings;
      const prompts = useSettingsStore.getState().prompts;
      if (!force && !settings.autoChapterNote) return;
      if (!resolveAiConfig(settings)) return; // 未配 AI 时静默跳过自动生成
      const spine = chapter.spine;
      const has = annotations.some((a) => a.kind === "chapter" && a.spine === spine);
      if (has && !force) return;
      const key = `${bookId}:${spine}`;
      if (noteInflight.has(key)) return;
      noteInflight.add(key);
      try {
        if (has && force) {
          // 重新生成：JSON 中移除旧导读（md 保留历史，SPEC §7-6）
          set((s) => ({ annotations: s.annotations.filter((a) => !(a.kind === "chapter" && a.spine === spine)) }));
          await saveAnnotations();
        }
        const anno: Annotation = {
          id: genId("c"),
          kind: "chapter",
          spine,
          anchor: null,
          content: "",
          createdAt: nowIso(),
        };
        const [win, full] = await Promise.all([
          beforeWindow(bookId, { spine, para: null }, settings.contextChars),
          chapterFullText(bookId, spine, settings.chapterNoteMaxChars),
        ]);
        const req = buildChapterNoteRequest({
          book,
          chapterLabel: chapterLabelFor(book, spine),
          readTitles: readChapterTitles(book, spine - 1),
          prevWindow: win,
          chapterText: full.text,
          truncated: full.truncated,
          promptSet: effectivePromptSet(prompts, book.contentType),
        });
        await runAnnotation(anno, req);
      } finally {
        noteInflight.delete(key);
      }
    },

    async addExcerptFromAnchor(anchor) {
      const { book, chapter } = get();
      if (!book || !chapter) return;
      const ex: Excerpt = {
        id: genId("e"),
        spine: chapter.spine,
        anchor,
        quote: anchor.quote,
        source: "manual",
        createdAt: nowIso(),
      };
      set((s) => ({ excerpts: [...s.excerpts, ex] }));
      await saveExcerpts();
      await appendExcerptMd(book, ex);
      toast("success", `已摘录：「${truncate(anchor.quote.replace(/\s+/g, " "), 18)}」`);
    },

    async importExcerptQuotes(quotes, source) {
      const { bookId, book } = get();
      if (!bookId || !book) return { located: 0, unlocated: 0 };
      // 汇齐全书章节文本（已读过的章有缓存，未读的现场解析并缓存）
      const chapters: string[][] = [];
      for (let s = 0; s < book.spineLength; s++) {
        chapters.push(await chapterText(bookId, s).catch(() => []));
      }
      let located = 0;
      let unlocated = 0;
      const added: Excerpt[] = [];
      for (const q of quotes) {
        const hit = locateQuote(q, chapters);
        if (hit) located++;
        else unlocated++;
        added.push({
          id: genId("e"),
          spine: hit?.spine ?? -1,
          anchor: hit?.anchor ?? null,
          quote: q,
          source,
          createdAt: nowIso(),
        });
      }
      set((s) => ({ excerpts: [...s.excerpts, ...added] }));
      await saveExcerpts();
      for (const ex of added) await appendExcerptMd(book, ex);
      return { located, unlocated };
    },

    async removeAnnotation(id) {
      set((s) => ({
        annotations: s.annotations.filter((a) => a.id !== id),
        focus: s.focus?.id === id ? null : s.focus,
      }));
      await saveAnnotations();
    },

    async removeExcerpt(id) {
      set((s) => ({ excerpts: s.excerpts.filter((e) => e.id !== id) }));
      await saveExcerpts();
    },

    setFocus(id, source) {
      set((s) => ({ focus: { id, source, nonce: (s.focus?.nonce ?? 0) + 1 } }));
    },
  };
});
