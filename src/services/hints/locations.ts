import type { Anchor, BookMeta, Footnote } from "../../types/models";
import { loadChapter } from "../epub/parse";
import { createAnchorFromRange, numberBlocks } from "../anchor/anchor";
import { matchFootnotes } from "./footnotes";

export interface FootnoteLocation { spine: number; anchor: Anchor }
/** Reuse the rendering matcher, including independent-note precedence. */
export async function findFootnoteLocations(book: BookMeta, note: Footnote, items: Footnote[], cancelled: () => boolean) {
  const locations: FootnoteLocation[] = [];
  const spines = note.sync ? Array.from({ length: book.spineLength }, (_, i) => i) : [note.spine];
  for (const spine of spines) {
    if (cancelled()) return [];
    const chapter = await loadChapter(book.id, spine);
    const root = document.createElement("div");
    root.innerHTML = chapter.html;
    numberBlocks(root);
    const { matches } = await matchFootnotes(root, items, spine);
    for (const match of matches) {
      if (match.hint.id !== note.id) continue;
      const anchor = createAnchorFromRange(match.range);
      if (anchor) locations.push({ spine, anchor });
    }
  }
  return locations.sort((a, b) => a.spine - b.spine || a.anchor.para - b.anchor.para || a.anchor.start - b.anchor.start);
}
