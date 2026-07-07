import { useEffect, useRef, useState } from "react";
import type { ContentType } from "../types/models";
import { useSettingsStore } from "../stores/settingsStore";
import { useLibraryStore } from "../stores/libraryStore";
import { useUiStore } from "../stores/uiStore";
import { FirstRunWizard } from "../components/shelf/FirstRunWizard";
import { RestoreAccess } from "../components/shelf/RestoreAccess";
import { BookCard } from "../components/shelf/BookCard";
import { ContentTypeDialog } from "../components/shelf/ContentTypeDialog";
import { navigate } from "../lib/router";

export function ShelfPage() {
  const bootState = useSettingsStore((s) => s.bootState);
  if (bootState === "wizard") return <FirstRunWizard />;
  if (bootState === "fs-restore") return <RestoreAccess />;
  return <Shelf />;
}

function Shelf() {
  const { books, refresh, importBook } = useLibraryStore();
  const openSettings = useUiStore((s) => s.openSettings);
  const mode = useSettingsStore((s) => s.mode);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f && /\.epub$/i.test(f.name)) setPendingFile(f);
  };

  const confirmImport = async (type: ContentType) => {
    if (!pendingFile) return;
    setImporting(true);
    const meta = await importBook(pendingFile, type);
    setImporting(false);
    setPendingFile(null);
    if (meta) navigate(`/read/${meta.id}`);
  };

  return (
    <div
      className="mx-auto flex h-full max-w-5xl flex-col px-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center justify-between py-6">
        <div>
          <h1 className="font-reading text-2xl font-semibold tracking-wide">伴读</h1>
          <p className="mt-1 text-xs text-ink-faint">
            AI 伴读工具 · {mode === "fs" ? "文件夹模式" : "浏览器模式"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            导入 epub
          </button>
          <button
            onClick={openSettings}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-accent-soft hover:text-ink"
          >
            设置
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <main className="flex-1 overflow-y-auto pb-10">
        {books.length === 0 ? (
          <div
            className={`mt-10 flex h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-colors ${
              dragging ? "border-accent bg-accent-soft" : "border-line"
            }`}
            onClick={() => fileRef.current?.click()}
          >
            <div className="text-4xl">📚</div>
            <p className="mt-3 text-sm text-ink-soft">把 epub 拖到这里，或点击选择文件</p>
            <p className="mt-1 text-xs text-ink-faint">导入后即可开始伴读</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
        {dragging && books.length > 0 && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/30">
            <div className="rounded-xl bg-card px-8 py-5 text-lg shadow-xl">松开以导入 epub</div>
          </div>
        )}
      </main>

      <ContentTypeDialog
        file={pendingFile}
        importing={importing}
        onCancel={() => setPendingFile(null)}
        onConfirm={confirmImport}
      />
    </div>
  );
}
