import { createTextQuoteSelectorMatcher } from "@apache-annotator/dom";
import type { Footnote, Hint } from "../../types/models";
import { matchHints, type HintMatch } from "./match";

export function footnoteHint(n: Footnote): Hint {
  return { id: n.id, file: "", kind: "inline", placement: "after", target: n.target, text: n.text, note_type: "reference" };
}
function overlaps(a: Range, b: Range) {
  const aStart = a.cloneRange(); aStart.collapse(true);
  const aEnd = a.cloneRange(); aEnd.collapse(false);
  const bStart = b.cloneRange(); bStart.collapse(true);
  const bEnd = b.cloneRange(); bEnd.collapse(false);
  return aStart.compareBoundaryPoints(Range.START_TO_START, bEnd) < 0 && aEnd.compareBoundaryPoints(Range.START_TO_START, bStart) > 0;
}
export async function matchFootnotes(root: HTMLElement, items: Footnote[], spine: number, cancelled: () => boolean = () => false) {
  // Independent occurrences take precedence over book-wide definitions.
  const local = items.filter(n => !n.sync && n.spine === spine);
  const result = await matchHints(root, local.map(footnoteHint), cancelled);
  const matches: HintMatch[] = [...result.matches];
  const shared = [...items].reverse().filter(n => n.sync);
  let yieldedAt = performance.now();
  for (const n of shared) {
    if (cancelled()) break;
    if (!n.target.exact) continue;
    const matcher = createTextQuoteSelectorMatcher({ type: "TextQuoteSelector", exact: n.target.exact });
    for await (const range of matcher(root)) {
      if (cancelled()) break;
      if (performance.now() - yieldedAt > 8) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        yieldedAt = performance.now();
        if (cancelled()) break;
      }
      if (range.toString() !== n.target.exact || matches.some(m => overlaps(m.range, range))) continue;
      matches.push({ hint: footnoteHint(n), range, method: "quote" });
    }
  }
  return { matches, missed: result.missed };
}
