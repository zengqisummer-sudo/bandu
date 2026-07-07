import { useEffect, useState } from "react";
import type { BookMeta, Progress } from "../../types/models";
import { storage } from "../../services/storage";
import { paths } from "../../services/storage/paths";
import { useLibraryStore } from "../../stores/libraryStore";
import { navigate } from "../../lib/router";

const TYPE_LABEL = { poetry: "诗", novel: "小说", social: "社科" } as const;

export function BookCard({ book }: { book: BookMeta }) {
  const cover = useLibraryStore((s) => s.covers[book.id]);
  const removeBook = useLibraryStore((s) => s.removeBook);
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let alive = true;
    storage()
      .readJson<Progress>("state", paths.progress(book.id))
      .then((p) => {
        if (alive && p) setPct(p.percent);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [book.id]);

  return (
    <div className="group relative">
      <button onClick={() => navigate(`/read/${book.id}`)} className="block w-full text-left">
        <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-line bg-card shadow-sm transition-shadow group-hover:shadow-md">
          {cover ? (
            <img src={cover} alt={book.title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-accent-soft p-4">
              <span className="font-reading text-center text-lg leading-relaxed text-ink-soft">{book.title}</span>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
            {TYPE_LABEL[book.contentType]}
          </span>
          {pct > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
              <div className="h-full bg-accent" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="mt-2">
          <div className="truncate text-sm font-medium">{book.title}</div>
          <div className="mt-0.5 flex items-center justify-between text-xs text-ink-faint">
            <span className="truncate">{book.author || "佚名"}</span>
            {pct > 0 && <span>{Math.round(pct * 100)}%</span>}
          </div>
        </div>
      </button>
      <button
        onClick={() => {
          if (confirm(`把《${book.title}》从书架移除？\n阅读产物 markdown 会保留，epub 与进度将删除。`)) {
            void removeBook(book.id);
          }
        }}
        className="absolute right-1.5 top-1.5 hidden rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/75 group-hover:block"
        title="移除"
      >
        ✕
      </button>
    </div>
  );
}
