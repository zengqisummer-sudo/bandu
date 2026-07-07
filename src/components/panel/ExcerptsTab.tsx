import { useMemo, useRef, useState } from "react";
import type { Excerpt } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { Modal } from "../common/Modal";
import { groupClippings, parseClippings, parsePlainText } from "../../services/import/kindle";
import { chapterLabelFor } from "../../services/ai/context";
import { toast } from "../../stores/uiStore";
import { truncate } from "../../lib/utils";

const SOURCE_LABEL = { manual: "选中摘录", kindle: "Kindle", text: "文本导入" } as const;

export function ExcerptsTab() {
  const excerpts = useReaderStore((s) => s.excerpts);
  const book = useReaderStore((s) => s.book);
  const [importOpen, setImportOpen] = useState(false);
  if (!book) return null;

  const located = excerpts
    .filter((e) => e.spine >= 0)
    .sort((a, b) => a.spine - b.spine || (a.anchor?.para ?? 0) - (b.anchor?.para ?? 0));
  const unlocated = excerpts.filter((e) => e.spine < 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs text-ink-faint">{excerpts.length} 条摘录 · 自动写入 摘录.md</span>
        <button
          onClick={() => setImportOpen(true)}
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-paper hover:opacity-90"
        >
          导入
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {excerpts.length === 0 ? (
          <p className="mt-8 text-center text-xs leading-relaxed text-ink-faint">
            选中正文点「摘录」
            <br />
            或导入 Kindle「My Clippings.txt」/ 粘贴文本
          </p>
        ) : (
          <>
            {located.map((e) => (
              <ExcerptCard key={e.id} ex={e} />
            ))}
            {unlocated.length > 0 && (
              <>
                <p className="mb-2 mt-4 px-1 text-xs text-ink-faint">未定位（原文中没找到）</p>
                {unlocated.map((e) => (
                  <ExcerptCard key={e.id} ex={e} />
                ))}
              </>
            )}
          </>
        )}
      </div>
      <ImportExcerptsDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function ExcerptCard({ ex }: { ex: Excerpt }) {
  const book = useReaderStore((s) => s.book);
  if (!book) return null;
  const label = ex.spine >= 0 ? chapterLabelFor(book, ex.spine) : "未定位";
  return (
    <div className="mb-2.5 rounded-xl border border-line p-3.5">
      <button
        disabled={ex.spine < 0}
        onClick={() => void useReaderStore.getState().openSpine(ex.spine, ex.anchor?.para ?? 0)}
        className="block w-full text-left"
      >
        <p className="border-l-2 border-accent pl-2 text-[13px] leading-relaxed text-ink">
          {truncate(ex.quote.replace(/\s+/g, " "), 120)}
        </p>
      </button>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
        <span>
          {label} · {SOURCE_LABEL[ex.source]}
        </span>
        <button
          onClick={() => {
            if (confirm("删除这条摘录？（markdown 中已写入的记录保留）")) {
              void useReaderStore.getState().removeExcerpt(ex.id);
            }
          }}
          className="hover:text-red-500"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function ImportExcerptsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const book = useReaderStore((s) => s.book);
  const [mode, setMode] = useState<"kindle" | "text">("kindle");
  const [kindleText, setKindleText] = useState("");
  const [plainText, setPlainText] = useState("");
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => (kindleText ? groupClippings(parseClippings(kindleText)) : new Map<string, string[]>()), [kindleText]);
  const groupNames = [...groups.keys()];
  const bestGroup = useMemo(() => {
    if (!book) return "";
    return (
      groupNames.find((g) => g.includes(book.title) || book.title.includes(g)) ?? groupNames[0] ?? ""
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindleText, book]);
  const selected = group || bestGroup;

  const quotes = mode === "kindle" ? (groups.get(selected) ?? []) : parsePlainText(plainText);

  const doImport = async () => {
    if (!quotes.length) return;
    setBusy(true);
    try {
      const r = await useReaderStore.getState().importExcerptQuotes(quotes, mode);
      toast("success", `导入完成：定位 ${r.located} 条${r.unlocated ? `，未定位 ${r.unlocated} 条` : ""}`);
      onClose();
      setKindleText("");
      setPlainText("");
      setGroup("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="导入摘录" wide>
      <div className="mb-3 flex gap-2">
        <ModeBtn active={mode === "kindle"} onClick={() => setMode("kindle")} label="Kindle 标注文件" />
        <ModeBtn active={mode === "text"} onClick={() => setMode("text")} label="粘贴文本" />
      </div>

      {mode === "kindle" ? (
        <>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border border-dashed border-line px-4 py-6 text-sm text-ink-soft hover:border-accent hover:bg-accent-soft/40"
          >
            {kindleText ? "重新选择文件" : "选择 My Clippings.txt（Kindle 磁盘的 documents 目录下）"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setKindleText(await f.text());
              e.target.value = "";
            }}
          />
          {groupNames.length > 0 && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-ink-soft">选择书（按标注文件中的书名分组）</label>
              <select
                value={selected}
                onChange={(e) => setGroup(e.target.value)}
                className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              >
                {groupNames.map((g) => (
                  <option key={g} value={g}>
                    {g}（{groups.get(g)?.length} 条）
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      ) : (
        <>
          <textarea
            value={plainText}
            onChange={(e) => setPlainText(e.target.value)}
            rows={8}
            placeholder={"粘贴摘录文本，空行分隔多条：\n\n第一条摘录……\n\n第二条摘录……"}
            className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
          />
        </>
      )}

      <div className="mt-4 flex items-center justify-between">
        <span className="text-xs text-ink-faint">
          {quotes.length ? `共 ${quotes.length} 条，导入时会在原文中定位（首次需解析全书，稍等片刻）` : ""}
        </span>
        <button
          onClick={() => void doImport()}
          disabled={!quotes.length || busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "定位中…" : "导入"}
        </button>
      </div>
    </Modal>
  );
}

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
        active ? "border-accent bg-accent-soft" : "border-line text-ink-soft hover:border-ink-faint"
      }`}
    >
      {label}
    </button>
  );
}
