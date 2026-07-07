import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Anchor } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { useChatStore } from "../../stores/chatStore";
import { createAnchorFromRange, numberBlocks, resolveAnchor } from "../../services/anchor/anchor";
import { resolveResources } from "../../services/epub/parse";
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
  const annotations = useReaderStore((s) => s.annotations);
  const excerpts = useReaderStore((s) => s.excerpts);
  const focus = useReaderStore((s) => s.focus);
  const reading = useSettingsStore((s) => s.settings.reading);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const blocksRef = useRef<HTMLElement[]>([]);
  const markersRef = useRef<HTMLElement[]>([]);
  const [domVersion, setDomVersion] = useState(0);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // ---- 注入章节 DOM、编号块、恢复滚动位置 ----
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !chapter) return;
    el.innerHTML = chapter.html;
    blocksRef.current = numberBlocks(el);
    markersRef.current = [];
    if (bookId) void resolveResources(el, bookId, chapter.href);

    const sc = scrollRef.current;
    const p = useReaderStore.getState().pendingScrollPara;
    if (sc) {
      const target = p != null && p > 0 ? blocksRef.current[p] : null;
      sc.scrollTop = target
        ? target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16
        : 0;
    }
    useReaderStore.getState().clearPendingScroll();
    setPopover(null);
    setDomVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.spine, chapter?.html, bookId]);

  // ---- 注释/摘录高亮 + 角标 ----
  useEffect(() => {
    if (!chapter || domVersion === 0) return;
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
      for (const e of excerpts) {
        if (e.spine !== chapter.spine || !e.anchor) continue;
        const r = resolveAnchor(blocks, e.anchor);
        if (r) exRanges.push(r);
      }
      api.reg.set("excerpt", new api.H(...exRanges));
      api.reg.delete("anno-active");
    }
  }, [domVersion, annotations, excerpts, chapter]);

  // ---- 面板 → 正文聚焦 ----
  useEffect(() => {
    if (!focus || focus.source !== "panel" || !chapter) return;
    const a = annotations.find((x) => x.id === focus.id);
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
  }, [focus?.nonce]);

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

  // ---- 角标点击 → 聚焦面板 ----
  const onClick = (e: ReactMouseEvent) => {
    const t = (e.target as HTMLElement).closest?.(".anno-marker") as HTMLElement | null;
    if (t?.dataset.annoId) {
      useReaderStore.getState().setFocus(t.dataset.annoId, "text");
      useUiStore.getState().setPanel(true, "annos");
    }
  };

  const act = (kind: "dive" | "ask" | "excerpt") => {
    if (!popover) return;
    const a = popover.anchor;
    setPopover(null);
    window.getSelection()?.removeAllRanges();
    if (kind === "dive") {
      useUiStore.getState().setPanel(true, "annos");
      void useReaderStore.getState().deepDive(a);
    } else if (kind === "ask") {
      useChatStore.getState().newSession(a.quote);
      useUiStore.getState().setPanel(true, "chat");
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
    <div
      ref={scrollRef}
      onScroll={() => {
        if (popover) setPopover(null);
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
    </div>
  );
}

function SelectionPopover({ x, y, onAct }: { x: number; y: number; onAct: (k: "dive" | "ask" | "excerpt") => void }) {
  const top = Math.max(8, y - 46);
  return (
    <div
      className="fixed z-40 flex -translate-x-1/2 items-center overflow-hidden rounded-lg border border-line bg-card shadow-xl"
      style={{ left: x, top }}
      onMouseDown={(e) => e.preventDefault() /* 保持选区 */}
    >
      <PopBtn onClick={() => onAct("dive")} label="深挖" title="生成锚定在这段文字上的注释" />
      <div className="h-5 w-px bg-line" />
      <PopBtn onClick={() => onAct("ask")} label="提问" title="就这段文字发起对话" />
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
