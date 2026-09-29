import DOMPurify from "dompurify";
import type { Book } from "epubjs";
import type { BookMeta, Footnote } from "../../types/models";
import { openEpub, SANITIZE_OPTS } from "./parse";
import { matchFootnotes } from "../hints/footnotes";
import { chapterLabelFor } from "../ai/context";

// Separate, read-only view: never change the chapter cache or its block numbering.
const views = new WeakMap<Book, Map<number, Promise<HTMLElement | null>>>();
async function pageView(bookId: string, spine: number) {
  const book = await openEpub(bookId);
  let chapters = views.get(book);
  if (!chapters) { chapters = new Map(); views.set(book, chapters); }
  let view = chapters.get(spine);
  if (!view) {
    view = (async () => {
      const section = book.spine.get(spine);
      if (!section) return null;
      const doc = await book.load(section.url) as Document;
      const root = document.createElement("div");
      root.innerHTML = doc.body?.innerHTML ?? doc.querySelector("body")?.innerHTML ?? "";
      for (const marker of root.querySelectorAll("[epub\\:type], [role='doc-pagebreak']")) {
        if (marker.getAttribute("role") !== "doc-pagebreak" && !marker.getAttribute("epub:type")?.split(/\s+/).includes("pagebreak")) continue;
        const label = marker.getAttribute("title") || marker.getAttribute("aria-label") || marker.textContent?.trim();
        if (label) marker.setAttribute("data-reader-page", label);
      }
      const list = (book.pageList as unknown as { pageList?: { href: string; page: string | number }[] })?.pageList ?? [];
      for (const item of list) {
        if (!item.href || !String(item.page).match(/\d/) || !Number.isFinite(Number(item.page))) continue;
        const [file, hash] = item.href.split("#");
        const path = decodeURIComponent(file);
        if (path !== section.href && !path.endsWith("/" + section.href) && !section.href.endsWith("/" + path)) continue;
        const target = hash ? [...root.querySelectorAll("[id]")].find(el => el.id === decodeURIComponent(hash)) : root.firstElementChild;
        if (target) target.setAttribute("data-reader-page", String(item.page));
      }
      // Most EPUBs have no print-page markers: do not sanitize or match their text.
      if (!root.querySelector("[data-reader-page]")) return null;
      root.innerHTML = DOMPurify.sanitize(root.innerHTML, SANITIZE_OPTS);
      return root;
    })();
    chapters.set(spine, view);
    void view.catch(() => chapters!.delete(spine));
  }
  return view;
}

async function computePageLabel(book: BookMeta, note: Footnote, signal: AbortSignal) {
  const fallback = chapterLabelFor(book, note.spine);
  const root = await pageView(book.id, note.spine);
  signal.throwIfAborted();
  if (!root) return fallback;
  const { matches } = await matchFootnotes(root, [{ ...note, sync: false }], note.spine);
  const match = matches[0]?.range;
  if (!match) return fallback;
  let label: string | null = null;
  for (const marker of root.querySelectorAll("[data-reader-page]")) {
    const boundary = document.createRange();
    boundary.selectNode(marker);
    boundary.collapse(true);
    if (boundary.compareBoundaryPoints(Range.START_TO_START, match) <= 0) label = marker.getAttribute("data-reader-page");
  }
  return label ? `p${label.replace(/^p(?:age)?\.?\s*/i, "")}` : fallback;
}

// Cache completed labels independently of mounted cards. Anchor edits change the key;
// text-only edits reuse it. Bound the cache, and release it when book metadata is released.
const labels = new WeakMap<BookMeta, Map<string, string>>();
let work: Promise<unknown> = Promise.resolve();
function idle(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const done = () => { signal.removeEventListener("abort", abort); resolve(); };
    const handle = window.requestIdleCallback(done, { timeout: 500 });
    const abort = () => { window.cancelIdleCallback(handle); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function footnotePageLabel(book: BookMeta, note: Footnote, signal: AbortSignal): Promise<string> {
  const key = JSON.stringify([note.spine, note.target]);
  let cache = labels.get(book);
  if (!cache) { cache = new Map(); labels.set(book, cache); }
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  // Serialize cold lookups and yield between them so they cannot all block a tab switch.
  const task = work.catch(() => {}).then(async () => {
    signal.throwIfAborted();
    const existing = cache.get(key);
    if (existing !== undefined) return existing;
    await idle(signal);
    signal.throwIfAborted();
    const label = await computePageLabel(book, note, signal);
    signal.throwIfAborted();
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, label);
    return label;
  });
  work = task.catch(() => {});
  return task;
}
