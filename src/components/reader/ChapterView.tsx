import { useReadingNavigation, returnToReading } from "../../stores/readingNavigation";
import { usePassageNavigation } from "../../stores/passageNavigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Anchor, Hint } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore, toast } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { createAnchorFromRange, numberBlocks, resolveAnchor } from "../../services/anchor/anchor";
import { resolveResources } from "../../services/epub/parse";
import { matchFootnotes, footnoteHint } from "../../services/hints/footnotes";
import { useFootnoteStore } from "../../stores/footnoteStore";
import { SelectionEditor } from "./SelectionEditor";
import { injectHints, removeInjectedHints } from "../../services/hints/inject";
import type { HintMatch } from "../../services/hints/match";
import { applyFriendlyLayout } from "../../services/reader/friendly";
import { Markdown } from "../common/Markdown";
import { throttle } from "../../lib/utils";

// CSS Custom Highlight API（Chrome/Edge 105+；本应用本就依赖 Chromium）
type HighlightCtor = new (...ranges: Range[]) => unknown;
function highlightApi(): { H: HighlightCtor; reg: Map<string, unknown> & { delete(k: string): void } } | null {
  const H = (window as unknown as { Highlight?: HighlightCtor }).Highlight;
  const reg = (CSS as unknown as { highlights?: Map<string, unknown> & { delete(k: string): void } }).highlights;
  return H && reg ? { H, reg } : null;
}

interface PopoverState {
  anchor: Anchor;
  x: number;
  y: number;
}

export function ChapterView() {
  const bookId = useReaderStore((s) => s.bookId);
  const book = useReaderStore((s) => s.book);
  const chapter = useReaderStore((s) => s.chapter);
  const chapterLoading = useReaderStore((s) => s.chapterLoading);
  const allAnnotations = useReaderStore((s) => s.annotations);
  const sessions = useChatStore((s) => s.sessions);
  const annotations = useMemo(() => [...allAnnotations.filter(a => a.kind === "passage" && a.source === "user"), ...sessions.filter(s => s.anchor).map(s => ({ id: s.id, spine: s.context.spine, anchor: s.anchor! }))], [allAnnotations, sessions]);
  const excerpts = useReaderStore((s) => s.excerpts);
  const focus = useReaderStore((s) => s.focus);
  const passage = usePassageNavigation(s => s.target);
  const excerptAnchors = useMemo(() => excerpts.flatMap(e => (e.segments ?? [e]).map(segment => ({ ...segment, id: e.id }))), [excerpts]);
  const footnotes = useFootnoteStore(s => s.items);
  const returnPoint = useReaderStore(s => s.returnPoint);
  const crossBookReturn = useReadingNavigation(s => s.origin);
  const pendingScroll = useReaderStore(s => s.pendingScrollPara);
  const showHints = useUiStore((s) => s.showHints);
  const reading = useSettingsStore((s) => s.settings.reading);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLElement[]>([]);
  const markersRef = useRef<HTMLElement[]>([]);
  const [domVersion, setDomVersion] = useState(0);
  /** hints 注入完成的轮次；旧式高亮/角标必须等它，避免文本节点被切分后 Range 失效 */
  const [hintPass, setHintPass] = useState(0);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [hintPop, setHintPop] = useState<{ hint: Hint; x: number; y: number } | null>(null);
  /** 手写批注编辑器（选中文字 → 批注） */
  const [noteEditor, setNoteEditor] = useState<{ anchor: Anchor; x: number; y: number; mode: "footnote" | "idea" } | null>(null);

  // ---- 注入章节 DOM、编号块、友好排版、恢复滚动位置 ----
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !chapter) return;
    // 在离屏 DOM 完成编号与排版，一次挂载，避免逐个插入时反复使正文样式失效。
    const prepared = document.createElement("template");
    prepared.innerHTML = chapter.html;
    blocksRef.current = numberBlocks(prepared.content);
    markersRef.current = [];
    // 友好排版必须在 numberBlocks 之后（只插空元素，textContent 不变，块编号/锚点不受影响）
    if (reading.friendly) applyFriendlyLayout(blocksRef.current);
    el.replaceChildren(prepared.content);
    if (bookId) void resolveResources(el, bookId, chapter.href);

    const sc = scrollRef.current;
    // 切换友好排版时 pendingScrollPara 为 null，回退到当前阅读进度的段落，保持位置
    const p = useReaderStore.getState().pendingScrollPara ?? useReaderStore.getState().progress.anchor.para;
    if (sc) {
      const target = p != null && p > 0 ? blocksRef.current[p] : null;
      sc.scrollTop = target
        ? target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16
        : 0;
    }
    useReaderStore.getState().clearPendingScroll();
    setPopover(null);
    setHintPop(null);
    setNoteEditor(null);
    setDomVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.spine, chapter?.html, bookId, reading.friendly]);

  useLayoutEffect(() => {
    if (pendingScroll === null || !scrollRef.current) return;
    const el = blocksRef.current[pendingScroll];
    if (el) scrollRef.current.scrollTop += el.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - 16;
    useReaderStore.getState().clearPendingScroll();
  }, [pendingScroll, chapter]);

  // ---- 随文注释：匹配（只读）→ 注入（改 DOM）→ hintPass++ 放行旧式高亮 ----
  // 隐藏时仍匹配（面板要匹配率与兜底列表），只是不注入。
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !chapter || domVersion === 0) return;
    let cancelled = false;
    setHintPop(null);
    removeInjectedHints(el);
    // Apache's async matcher must never observe nodes mutated by React/highlights.
    // Keep each pass on its own immutable snapshot, including existing block numbers.
    const snapshot = el.cloneNode(true) as HTMLElement;
    void (async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 16));
      if (cancelled) return;
      const { matches, missed } = await matchFootnotes(snapshot, footnotes, chapter.spine, () => cancelled);
      if (cancelled) return;
      const liveMatches: HintMatch[] = [];
      const injectFailed: string[] = [];
      for (const match of matches) {
        const anchor = createAnchorFromRange(match.range);
        if (anchor) anchor.quote = match.range.toString();
        const range = anchor ? resolveAnchor(blocksRef.current, anchor) : null;
        if (range) liveMatches.push({ ...match, range });
        else injectFailed.push(match.hint.id);
      }
      if (showHints) injectFailed.push(...injectHints(el, liveMatches));
      const anchored = [...new Set(matches.map((m) => m.hint.id).filter((id) => !injectFailed.includes(id)))];
      useReaderStore.getState().reportHintRender({
        spine: chapter.spine,
        total: new Set([...matches.map(m => m.hint.id), ...missed.map(h => h.id)]).size,
        anchored,
        missed: [...missed.map((h) => h.id), ...injectFailed],
      });
      setHintPass((p) => p + 1);
    })().catch(e => {
      if (cancelled) return;
      const ids = footnotes.filter(n => n.sync || n.spine === chapter.spine).map(n => n.id);
      useReaderStore.getState().reportHintRender({ spine: chapter.spine, total: ids.length, anchored: [], missed: ids });
      setHintPass(p => p + 1);
      toast("error", `注释定位失败，内容仍保留在侧边栏：${String(e)}`);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domVersion, footnotes, showHints]);

  // ---- 注释/摘录高亮 + 角标（在 hints 注入完成后运行） ----
  useEffect(() => {
    if (!chapter || hintPass === 0) return;
    const blocks = blocksRef.current;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // 先插角标（span 无文本，不影响字符偏移），再统一重新解析并注册高亮
    for (const a of annotations) {
      if (a.spine !== chapter.spine || !a.anchor) continue;
      const r = resolveAnchor(blocks, a.anchor);
      if (!r) continue;
      const m = document.createElement("span");
      m.className = "anno-marker";
      m.dataset.annoId = a.id;
      const end = r.cloneRange();
      end.collapse(false);
      try {
        end.insertNode(m);
        markersRef.current.push(m);
      } catch {
        /* 插入失败不影响高亮 */
      }
    }

    const api = highlightApi();
    if (api) {
      const annoRanges: Range[] = [];
      for (const a of annotations) {
        if (a.spine !== chapter.spine || !a.anchor) continue;
        const r = resolveAnchor(blocks, a.anchor);
        if (r) annoRanges.push(r);
      }
      api.reg.set("anno", new api.H(...annoRanges));
      const exRanges: Range[] = [];
      for (const e of excerptAnchors) {
        if (e.spine !== chapter.spine || !e.anchor) continue;
        const r = resolveAnchor(blocks, e.anchor);
        if (r) exRanges.push(r);
      }
      api.reg.set("excerpt", new api.H(...exRanges));
      api.reg.delete("anno-active");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintPass, annotations, excerpts, chapter]);

  // ---- 面板 → 正文聚焦 ----
  useEffect(() => {
    if (!focus || focus.source !== "panel" || !chapter) return;
    const a = [...annotations, ...excerpts].find((x) => x.id === focus.id);
    if (!a?.anchor || a.spine !== chapter.spine) return;
    const r = resolveAnchor(blocksRef.current, a.anchor);
    const api = highlightApi();
    if (r && api) api.reg.set("anno-active", new api.H(r));
    const blockEl = blocksRef.current[a.anchor.para];
    const sc = scrollRef.current;
    if (blockEl && sc) {
      sc.scrollTo({
        top: blockEl.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 90,
        behavior: "smooth",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, hintPass, chapter]);

  useEffect(() => {
    if (!returnPoint) { highlightApi()?.reg.delete("anno-active"); return; }
    if (!passage || passage.bookId !== bookId || passage.spine !== chapter?.spine || passage.focusNonce !== focus?.nonce) return;
    const range = resolveAnchor(blocksRef.current, passage.anchor);
    const api = highlightApi();
    const sc = scrollRef.current;
    if (!range || !sc) return;
    if (api) api.reg.set("anno-active", new api.H(range));
    const rect = range.getBoundingClientRect();
    sc.scrollTo({ top: sc.scrollTop + rect.top - sc.getBoundingClientRect().top - 90, behavior: "smooth" });
  }, [passage, hintPass, chapter, bookId, returnPoint, focus?.nonce]);

  // ---- 滚动：上报阅读位置（节流） ----
  const reportScroll = useMemo(
    () =>
      throttle(() => {
        const sc = scrollRef.current;
        if (!sc) return;
        const top = sc.getBoundingClientRect().top;
        const blocks = blocksRef.current;
        for (let i = 0; i < blocks.length; i++) {
          if (blocks[i].getBoundingClientRect().bottom > top + 12) {
            useReaderStore.getState().reportPosition(i);
            return;
          }
        }
      }, 600),
    []
  );

  // ---- 选中 → 浮条 ----
  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const el = contentRef.current;
      if (!sel || sel.isCollapsed || !el) {
        setPopover(null);
        return;
      }
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        setPopover(null);
        return;
      }
      const anchor = createAnchorFromRange(range);
      if (!anchor) {
        setPopover(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setPopover({ anchor, x: rect.left + rect.width / 2, y: rect.top });
    }, 0);
  };

  const locate = (id: string, tab: "annos" | "chat" | "excerpts") => {
    useReaderStore.getState().setFocus(id, "text");
    if (sessions.some(s => s.id === id)) useChatStore.getState().select(id);
    useUiStore.getState().setPanel(true, tab);
  };
  const onClick = (e: ReactMouseEvent) => {
    if (!window.getSelection()?.isCollapsed) return;
    const target = e.target as HTMLElement;
    const marker = target.closest<HTMLElement>(".anno-marker");
    if (marker?.dataset.annoId) { locate(marker.dataset.annoId, "chat"); setHintPop(null); return; }
    const mark = target.closest<HTMLElement>("mark.hint-mark");
    if (mark?.dataset.hintId) { locate(mark.dataset.hintId, "annos"); return; }
    for (const item of [...annotations, ...excerptAnchors]) {
      if (item.spine !== chapter?.spine || !item.anchor) continue;
      const r = resolveAnchor(blocksRef.current, item.anchor);
      if (r && [...r.getClientRects()].some(rect => e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom)) {
        locate(item.id, excerpts.some(x => x.id === item.id) ? "excerpts" : "chat"); return;
      }
    }
    setHintPop(null);
  };
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const keepHover = () => clearTimeout(hoverTimer.current);
  const leaveHover = () => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHintPop(null), 220); };
  const onHover = (e: ReactMouseEvent) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>("mark.hint-mark");
    const note = footnotes.find(n => n.id === mark?.dataset.hintId);
    if (!note || !mark) { leaveHover(); return; }
    keepHover(); const rect = mark.getBoundingClientRect();
    setHintPop({ hint: footnoteHint(note), x: rect.left + rect.width / 2, y: rect.bottom });
  };

  const act = (kind: "footnote" | "ask" | "excerpt" | "note") => {
    if (!popover) return;
    const a = popover.anchor;
    const { x, y } = popover;
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    if (kind === "footnote") {
      setNoteEditor({ anchor: a, x, y, mode: "footnote" });
    } else if (kind === "ask") {
      const id = useChatStore.getState().newSession(a.quote, a);
      locate(id, "chat");
    } else if (kind === "note") {
      setNoteEditor({ anchor: a, x, y, mode: "idea" });
    } else {
      void useReaderStore.getState().addExcerptFromAnchor(a);
    }
  };

  if (!chapter) {
    return <div className="flex flex-1 items-center justify-center text-ink-faint">载入章节…</div>;
  }

  const spine = chapter.spine;
  const last = (book?.spineLength ?? 1) - 1;

  return (
    <div className="relative flex min-w-0 flex-1">
    <div
      ref={scrollRef}
      onScroll={() => {
        if (popover) setPopover(null);
        if (hintPop) setHintPop(null);
        reportScroll();
      }}
      className={`relative min-w-0 flex-1 overflow-y-auto transition-opacity ${chapterLoading ? "opacity-50" : ""}`}
    >
      <div className="mx-auto px-8 py-10" style={{ maxWidth: reading.maxWidth }}>
        <div
          ref={contentRef}
          className="chapter-content"
          style={{ fontSize: reading.fontSize, lineHeight: reading.lineHeight }}
          onMouseUp={onMouseUp}
          onClick={onClick}
          onMouseOver={onHover}
          onMouseLeave={leaveHover}
        />
        <div className="mb-4 mt-14 flex items-center justify-between border-t border-line pt-5">
          <button
            disabled={spine <= 0}
            onClick={() => void useReaderStore.getState().openSpine(spine - 1)}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-accent-soft disabled:opacity-30"
          >
            ‹ 上一章
          </button>
          <span className="text-xs text-ink-faint">
            {spine + 1} / {last + 1}
          </span>
          <button
            disabled={spine >= last}
            onClick={() => void useReaderStore.getState().openSpine(spine + 1)}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-soft hover:bg-accent-soft disabled:opacity-30"
          >
            下一章 ›
          </button>
        </div>
      </div>

      {popover && <SelectionPopover x={popover.x} y={popover.y} onAct={act} />}
      {hintPop && <HintPopover hint={hintPop.hint} x={hintPop.x} y={hintPop.y} onClose={() => setHintPop(null)} onEnter={keepHover} onLeave={leaveHover} onEdit={() => { useFootnoteStore.getState().edit(hintPop.hint.id); setHintPop(null); }} />}
      {noteEditor && (
        <SelectionEditor
          mode={noteEditor.mode}
          anchor={noteEditor.anchor}
          x={noteEditor.x}
          y={noteEditor.y}
          onClose={() => setNoteEditor(null)}
        />
      )}
    </div>
      {(returnPoint || crossBookReturn) && <div className="absolute bottom-4 right-5 z-30 flex justify-end pointer-events-none"><button className="pointer-events-auto rounded-lg border border-line bg-card px-4 py-2 text-sm shadow-lg hover:bg-accent-soft" onClick={() => void returnToReading()}>返回阅读进度</button></div>}
    </div>
  );
}

/** 行内注释浮层：点击 hint 标注短语弹出（ANNOTATION_SPEC §5.4） */
function HintPopover({ hint, x, y, onClose, onEnter, onLeave, onEdit }: { hint: Hint; x: number; y: number; onClose: () => void; onEnter(): void; onLeave(): void; onEdit(): void }) {
  const width = 320;
  const left = Math.min(Math.max(width / 2 + 12, x), window.innerWidth - width / 2 - 12);
  const top = Math.max(8, Math.min(y + 8, window.innerHeight - 260));
  return (
    <div
      className="fixed z-40 max-h-[60vh] overflow-auto -translate-x-1/2 rounded-xl border border-line bg-card p-3 shadow-xl"
      style={{ left, top, width }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onEdit}
      role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter") onEdit(); }}
    >
      <div className="flex justify-end">
        <button onClick={e => { e.stopPropagation(); onClose(); }} className="px-1 text-xs text-ink-faint hover:text-ink" title="关闭">
          ✕
        </button>
      </div>
      <Markdown text={hint.text} />
    </div>
  );
}

function SelectionPopover({
  x,
  y,
  onAct,
}: {
  x: number;
  y: number;
  onAct: (k: "footnote" | "ask" | "excerpt" | "note") => void;
}) {
  const top = Math.max(8, y - 46);
  return (
    <div
      className="fixed z-40 flex -translate-x-1/2 items-center overflow-hidden rounded-lg border border-line bg-card shadow-xl"
      style={{ left: x, top }}
      onMouseDown={(e) => e.preventDefault() /* 保持选区 */}
    >
      <PopBtn onClick={() => onAct("footnote")} label="注释" title="写一条脚注式解释" />
      <div className="h-5 w-px bg-line" />
      <PopBtn onClick={() => onAct("ask")} label="问AI" title="就这段文字发起对话" />
      <div className="h-5 w-px bg-line" />
      <PopBtn onClick={() => onAct("note")} label="写想法" title="写下想法并关联话题" />
      <div className="h-5 w-px bg-line" />
      <PopBtn onClick={() => onAct("excerpt")} label="摘录" title="存入摘录并写进 markdown" />
    </div>
  );
}

function PopBtn({ onClick, label, title }: { onClick: () => void; label: string; title: string }) {
  return (
    <button onClick={onClick} title={title} className="px-3.5 py-2 text-sm transition-colors hover:bg-accent-soft">
      {label}
    </button>
  );
}
