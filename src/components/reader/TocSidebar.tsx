import type { TocItem } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";

export function TocSidebar({ onNavigate }: { onNavigate: () => void }) {
  const book = useReaderStore((s) => s.book);
  const chapter = useReaderStore((s) => s.chapter);
  const openSpine = useReaderStore((s) => s.openSpine);
  if (!book) return null;

  const go = (item: TocItem) => {
    if (item.spine < 0) return;
    void openSpine(item.spine);
    onNavigate();
  };

  const render = (items: TocItem[], depth: number) =>
    items.map((it, i) => (
      <div key={`${depth}-${i}-${it.spine}`}>
        <button
          onClick={() => go(it)}
          disabled={it.spine < 0}
          className={`w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
            it.spine === chapter?.spine ? "bg-accent-soft font-medium text-ink" : "text-ink-soft hover:bg-accent-soft/60"
          } ${it.spine < 0 ? "opacity-40" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={it.label}
        >
          {it.label}
        </button>
        {it.children.length > 0 && render(it.children, depth + 1)}
      </div>
    ));

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-card p-2">
      {book.toc.length ? render(book.toc, 0) : <p className="p-3 text-xs text-ink-faint">这本书没有目录信息</p>}
    </aside>
  );
}
