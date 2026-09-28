import { create } from "zustand";
import type {
  Anchor,
  Annotation,
  AnnotationsFile,
  BookMeta,
  Excerpt,
  ExcerptsFile,
  HintsFile,
  Progress,
} from "../types/models";
import { storage } from "../services/storage";
import { paths } from "../services/storage/paths";
import { chapterText, closeEpub, loadChapter } from "../services/epub/parse";
import { beforeWindow, chapterFullText, chapterLabelFor, readChapterTitles } from "../services/ai/context";
import {
  buildChapterHintsRequest,
  buildChapterNoteRequest,
  buildPassageRequest,
  effectivePromptSet,
} from "../services/ai/prompts";
import { friendlyAiError, resolveAiConfig, streamChat } from "../services/ai/client";
import { logAiExchange } from "../services/ai/log";
import { parseHintsOutput } from "../services/hints/parse";
import {
  appendAnnotationMd,
  appendExcerptMd,
  appendHintsMd,
  updateAnnotationMd,
  updateExcerptTagsMd,
} from "../services/product/markdown";
import { recordTagUse } from "../lib/tags";
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

// 章节导读/随文注释并发防抖 & 进度写盘节流（模块级，不进 store）
const noteInflight = new Set<string>();
const hintsInflight = new Set<string>();
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

/** ChapterView 匹配/注入完成后的回执：面板据此显示匹配率与未锚定兜底列表 */
export interface HintRenderReport {
  spine: number;
  total: number;
  anchored: string[];
  missed: string[];
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
  /** 当前章节的随文注释文件（无则 null） */
  hints: HintsFile | null;
  /** 正在生成随文注释的 spine（null = 空闲） */
  hintsGeneratingSpine: number | null;
  /** 生成中已流出的字符数（进度显示） */
  hintsProgress: number;
  hintRender: HintRenderReport | null;
  /** 最近一次随文注释生成失败的详情（含模型原始输出，供诊断） */
  hintsError: { spine: number; message: string; raw: string } | null;

  openBook(id: string): Promise<boolean>;
  closeBook(): void;
  openSpine(spine: number, para?: number): Promise<void>;
  clearPendingScroll(): void;
  reportPosition(para: number): void;
  deepDive(anchor: Anchor): Promise<void>;
  generateChapterNote(force?: boolean): Promise<void>;
  generateChapterHints(auto?: boolean): Promise<void>;
  reportHintRender(report: HintRenderReport | null): void;
  /** 手写批注：anchor 为 null 表示不锚定原文的本章批注 */
  addManualAnnotation(anchor: Anchor | null, text: string): Promise<void>;
  /** 编辑批注正文：应用内 JSON 为准，单向同步进 Obsidian markdown（不反向） */
  editAnnotation(id: string, content: string): Promise<void>;
  addExcerptFromAnchor(anchor: Anchor): Promise<void>;
  importExcerptQuotes(quotes: string[], source: "kindle" | "text"): Promise<{ located: number; unlocated: number }>;
  removeAnnotation(id: string): Promise<void>;
  removeExcerpt(id: string): Promise<void>;
  /** 批量删除摘录：JSON 整写一次；md 保留历史 */
  removeExcerpts(ids: string[]): Promise<void>;
  /** 更新摘录标签：JSON 整写 + 摘录.md 定点同步标签行 */
  updateExcerptTags(id: string, tags: string[]): Promise<void>;
  /** 批量追加标签：并入选中摘录已有标签（去重），JSON 整写一次 + 逐条同步 md 标签行 */
  addTagsToExcerpts(ids: string[], tags: string[]): Promise<void>;
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
    const scene = anno.kind === "chapter" ? "章节导读" : "段落深挖";
    const bookId = get().bookId;
    let acc = "";
    try {
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
      if (bookId)
        await logAiExchange({
          bookId, scene, spine: anno.spine, provider: cfg.provider, model: cfg.model,
          system: req.system, messages: req.messages, output: acc, status: "成功",
        });
    } catch (e) {
      set((s) => ({ annotations: s.annotations.filter((a) => a.id !== anno.id) }));
      if (bookId)
        await logAiExchange({
          bookId, scene, spine: anno.spine, provider: cfg.provider, model: cfg.model,
          system: req.system, messages: req.messages, output: acc, status: `请求失败：${friendlyAiError(e)}`,
        });
      toast("error", `注释生成失败：${friendlyAiError(e)}`);
    } finally {
      set((s) => {
        const { [anno.id]: _drop, ...rest } = s.streaming;
        return { streaming: rest };
      });
    }
  }

  /** 载入当前章节的 hints 文件；没有且开了自动生成则触发生成 */
  async function loadChapterHints() {
    const { bookId, chapter } = get();
    if (!bookId || !chapter) return;
    const spine = chapter.spine;
    const file = await storage()
      .readJson<HintsFile>("state", paths.hints(bookId, spine))
      .catch(() => null);
    if (get().bookId !== bookId || get().chapter?.spine !== spine) return; // 已切章/关书
    if (file && file.version === 1 && Array.isArray(file.hints)) {
      set({ hints: file });
      return;
    }
    const settings = useSettingsStore.getState().settings;
    if (settings.autoChapterHints && resolveAiConfig(settings)) void get().generateChapterHints(true);
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
    hints: null,
    hintsGeneratingSpine: null,
    hintsProgress: 0,
    hintRender: null,
    hintsError: null,

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
        hints: null,
        hintRender: null,
        hintsError: null,
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
        hints: null,
        hintRender: null,
        hintsError: null,
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
          hints: null,
          hintRender: null,
          hintsError: null,
        });
        scheduleProgressWrite(bookId, progress);
        void get().generateChapterNote(false);
        void loadChapterHints();
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

    async generateChapterHints(auto = false) {
      const { bookId, book, chapter } = get();
      if (!bookId || !book || !chapter) return;
      const spine = chapter.spine;
      const settings = useSettingsStore.getState().settings;
      const prompts = useSettingsStore.getState().prompts;
      const cfg = resolveAiConfig(settings);
      if (!cfg) {
        if (!auto) toast("error", "请先在设置中配置 AI 提供商与 API key");
        return;
      }
      if (auto && get().hints) return; // 自动模式只补缺，不覆盖
      const key = `${bookId}:${spine}`;
      if (hintsInflight.has(key)) return;
      hintsInflight.add(key);
      set({ hintsGeneratingSpine: spine, hintsProgress: 0, hintsError: null });
      let acc = "";
      let logged = false;
      let req: { system: string; messages: { role: "user" | "assistant"; content: string }[] } | null = null;
      try {
        // 防剧透边界 = 本章末尾（SPEC §4.3）；每条注释的锚点前边界由 prompt 约束
        const [win, full] = await Promise.all([
          beforeWindow(bookId, { spine, para: null }, settings.contextChars),
          chapterFullText(bookId, spine, settings.chapterNoteMaxChars),
        ]);
        req = buildChapterHintsRequest({
          book,
          chapterLabel: chapterLabelFor(book, spine),
          readTitles: readChapterTitles(book, spine - 1),
          prevWindow: win,
          chapterText: full.text,
          truncated: full.truncated,
          promptSet: effectivePromptSet(prompts, book.contentType),
        });
        for await (const chunk of streamChat(cfg, { ...req, maxTokens: 4096 })) {
          acc += chunk;
          set({ hintsProgress: acc.length });
        }
        const hints = parseHintsOutput(acc, { spine, file: chapter.href });
        await logAiExchange({
          bookId, scene: "随文注释", spine, provider: cfg.provider, model: cfg.model,
          system: req.system, messages: req.messages, output: acc,
          status: hints.length ? `成功，解析 ${hints.length} 条` : "解析失败：未从输出得到有效注释（见原始返回）",
        });
        logged = true;
        if (hints.length === 0) {
          // 落地原始输出便于排查：到底是没输出 JSON，还是字段不匹配
          console.error(
            `[hints] spine=${spine} 解析得 0 条，原始输出长度=${acc.length}，前 300 字：\n`,
            acc.slice(0, 300),
          );
          const looksJson = acc.includes("{") && acc.includes("}");
          throw new Error(
            looksJson
              ? "模型输出含 JSON 但字段不匹配（应为 target.exact + text），请检查 prompt 或重试"
              : "模型未输出 JSON 数组（可能输出了纯文本说明），请重试",
          );
        }
        const file: HintsFile = {
          version: 1,
          metadata: {
            book: book.title,
            chapter: chapterLabelFor(book, spine),
            spine,
            language: "zh",
            policy: "conservative-no-spoilers",
            scope: "chapter",
            generatedAt: nowIso(),
            model: cfg.model,
            truncated: full.truncated,
            sourceChars: full.text.length,
          },
          hints,
        };
        // 重新生成 = 整份替换 JSON；md 存档只追加，历史版本保留
        await storage().writeStateJson(paths.hints(bookId, spine), file);
        if (get().bookId === bookId && get().chapter?.spine === spine) {
          set({ hints: file, hintRender: null });
        }
        await appendHintsMd(book, file);
        toast("success", `已生成 ${hints.length} 条随文注释`);
      } catch (e) {
        const message = friendlyAiError(e);
        if (!logged && req)
          await logAiExchange({
            bookId, scene: "随文注释", spine, provider: cfg.provider, model: cfg.model,
            system: req.system, messages: req.messages, output: acc, status: `请求失败：${message}`,
          });
        // 失败详情（含模型原始输出）进面板诊断卡片，不再只留一句 toast
        set({ hintsError: { spine, message, raw: acc } });
        toast("error", `随文注释生成失败：${message}`);
      } finally {
        hintsInflight.delete(key);
        set((s) => (s.hintsGeneratingSpine === spine ? { hintsGeneratingSpine: null, hintsProgress: 0 } : {}));
      }
    },

    reportHintRender(report) {
      set({ hintRender: report });
    },

    async addManualAnnotation(anchor, text) {
      const { book, chapter } = get();
      const content = text.trim();
      if (!book || !chapter || !content) return;
      const anno: Annotation = {
        id: genId("m"),
        kind: "passage",
        spine: chapter.spine,
        anchor,
        content,
        source: "user",
        createdAt: nowIso(),
      };
      set((s) => ({ annotations: [...s.annotations, anno] }));
      await saveAnnotations();
      await appendAnnotationMd(book, anno);
      toast("success", "已保存批注");
    },

    async editAnnotation(id, content) {
      const { book, annotations } = get();
      const text = content.trim();
      const old = annotations.find((a) => a.id === id);
      if (!book || !old || !text || text === old.content) return;
      const next: Annotation = { ...old, content: text };
      set((s) => ({ annotations: s.annotations.map((a) => (a.id === id ? next : a)) }));
      await saveAnnotations();
      try {
        await updateAnnotationMd(book, next);
      } catch (e) {
        console.warn("阅读注释.md 同步失败（应用内已保存）", e);
      }
      toast("success", "已更新批注");
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

    async removeExcerpts(ids) {
      if (!ids.length) return;
      const idSet = new Set(ids);
      set((s) => ({ excerpts: s.excerpts.filter((e) => !idSet.has(e.id)) }));
      await saveExcerpts();
    },

    async updateExcerptTags(id, tags) {
      const { book, excerpts } = get();
      const old = excerpts.find((e) => e.id === id);
      if (!book || !old) return;
      const next: Excerpt = { ...old, tags: tags.length ? tags : undefined };
      set((s) => ({ excerpts: s.excerpts.map((e) => (e.id === id ? next : e)) }));
      await saveExcerpts();
      recordTagUse(tags.filter((t) => !old.tags?.includes(t))); // 只记新增，避免重复计数
      try {
        await updateExcerptTagsMd(book, next);
      } catch (e) {
        console.warn("摘录.md 标签同步失败（应用内已保存）", e);
      }
    },

    async addTagsToExcerpts(ids, tags) {
      const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
      if (!ids.length || !clean.length) return;
      const { book, excerpts } = get();
      const idSet = new Set(ids);
      // 逐条并入（去重），记录真正发生变化的条目用于 md 同步
      const changed: Excerpt[] = [];
      const nextExcerpts = excerpts.map((e) => {
        if (!idSet.has(e.id)) return e;
        const merged = [...(e.tags ?? [])];
        for (const t of clean) if (!merged.includes(t)) merged.push(t);
        if (merged.length === (e.tags?.length ?? 0)) return e; // 全是已有标签，无变化
        const next: Excerpt = { ...e, tags: merged };
        changed.push(next);
        return next;
      });
      if (!changed.length) return;
      set({ excerpts: nextExcerpts });
      await saveExcerpts();
      recordTagUse(clean);
      if (!book) return;
      for (const ex of changed) {
        try {
          await updateExcerptTagsMd(book, ex);
        } catch (e) {
          console.warn("摘录.md 标签同步失败（应用内已保存）", e);
        }
      }
    },

    setFocus(id, source) {
      set((s) => ({ focus: { id, source, nonce: (s.focus?.nonce ?? 0) + 1 } }));
    },
  };
});
