import { useEffect, useMemo, useRef, useState } from "react";
import type { BookMeta, Excerpt } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { Modal } from "../common/Modal";
import { TagInput } from "../common/TagInput";
import { ExcerptImageModal } from "./ExcerptImageModal";
import { groupClippings, parseClippings, parsePlainText } from "../../services/import/kindle";
import { chapterLabelFor } from "../../services/ai/context";
import { toast } from "../../stores/uiStore";
import { truncate } from "../../lib/utils";

const SOURCE_LABEL = { manual: "选中摘录", kindle: "Kindle", text: "文本导入" } as const;

/** 按章分组（located 已按 spine 排序 → 同章连续）；未定位归入「未定位」组。 */
function groupByChapter(book: BookMeta, list: Excerpt[]): { label: string; items: Excerpt[] }[] {
  const groups: { label: string; items: Excerpt[] }[] = [];
  for (const e of list) {
    const label = e.spine >= 0 ? chapterLabelFor(book, e.spine) : "未定位";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }
  return groups;
}

export function ExcerptsTab() {
  const excerpts = useReaderStore((s) => s.excerpts);
  const book = useReaderStore((s) => s.book);
  const [importOpen, setImportOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tagOpen, setTagOpen] = useState(false);
  if (!book) return null;

  const located = excerpts
    .filter((e) => e.spine >= 0)
    .sort((a, b) => a.spine - b.spine || (a.anchor?.para ?? 0) - (b.anchor?.para ?? 0));
  const unlocated = excerpts.filter((e) => e.spine < 0);
  const ordered = [...located, ...unlocated];
  // 本书已用过的标签（TagInput 联想候选的一部分）
  const bookTags = [...new Set(excerpts.flatMap((e) => e.tags ?? []))];
  const groups = groupByChapter(book, ordered);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  const clear = () => setSelected(new Set());
  const exitSelect = () => {
    setSelectMode(false);
    clear();
  };

  const allSelected = ordered.length > 0 && selected.size === ordered.length;
  const selectedIds = ordered.filter((e) => selected.has(e.id)).map((e) => e.id);

  const doDelete = () => {
    if (!selectedIds.length) return;
    if (confirm(`删除选中的 ${selectedIds.length} 条摘录？（摘录.md 中已写入的记录保留）`)) {
      void useReaderStore.getState().removeExcerpts(selectedIds);
      toast("success", `已删除 ${selectedIds.length} 条摘录`);
      exitSelect();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        {selectMode ? (
          <>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => setMany(ordered.map((x) => x.id), e.target.checked)}
                className="accent-[var(--accent)]"
              />
              全选本书 · 已选 {selected.size}
            </label>
            <button onClick={exitSelect} className="text-xs text-ink-faint hover:text-ink">
              取消
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-faint">{excerpts.length} 条摘录 · 自动写入 摘录.md</span>
            <span className="flex items-center gap-2">
              {excerpts.length > 0 && (
                <button
                  onClick={() => setSelectMode(true)}
                  className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-soft hover:border-accent hover:text-ink"
                >
                  选择
                </button>
              )}
              <button
                onClick={() => setImportOpen(true)}
                className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-paper hover:opacity-90"
              >
                导入
              </button>
            </span>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {excerpts.length === 0 ? (
          <p className="mt-8 text-center text-xs leading-relaxed text-ink-faint">
            选中正文点「摘录」
            <br />
            或导入 Kindle「My Clippings.txt」/ 粘贴文本
          </p>
        ) : selectMode ? (
          groups.map((g, gi) => {
            const ids = g.items.map((x) => x.id);
            const allInChapter = ids.every((id) => selected.has(id));
            return (
              <div key={`${g.label}-${gi}`} className={gi ? "mt-4" : ""}>
                <label className="mb-2 flex cursor-pointer items-center gap-1.5 px-1 text-xs text-ink-faint">
                  <input
                    type="checkbox"
                    checked={allInChapter}
                    onChange={(e) => setMany(ids, e.target.checked)}
                    className="accent-[var(--accent)]"
                  />
                  {g.label === "未定位" ? "未定位（原文中没找到）" : g.label}
                  <span className="text-ink-faint/70">· 本章全选</span>
                </label>
                {g.items.map((e) => (
                  <ExcerptCard
                    key={e.id}
                    ex={e}
                    bookTags={bookTags}
                    selectMode
                    checked={selected.has(e.id)}
                    onToggle={() => toggle(e.id)}
                  />
                ))}
              </div>
            );
          })
        ) : (
          <>
            {located.map((e) => (
              <ExcerptCard key={e.id} ex={e} bookTags={bookTags} />
            ))}
            {unlocated.length > 0 && (
              <>
                <p className="mb-2 mt-4 px-1 text-xs text-ink-faint">未定位（原文中没找到）</p>
                {unlocated.map((e) => (
                  <ExcerptCard key={e.id} ex={e} bookTags={bookTags} />
                ))}
              </>
            )}
          </>
        )}
      </div>
      {selectMode && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="text-xs text-ink-faint">已选 {selected.size} 条</span>
          <span className="flex items-center gap-2">
            <button
              onClick={() => setTagOpen(true)}
              disabled={!selected.size}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft hover:border-accent hover:text-ink disabled:opacity-40"
            >
              批量打标签
            </button>
            <button
              onClick={doDelete}
              disabled={!selected.size}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-red-500 hover:border-red-400 hover:bg-red-50 disabled:opacity-40"
            >
              批量删除
            </button>
          </span>
        </div>
      )}
      <ImportExcerptsDialog open={importOpen} onClose={() => setImportOpen(false)} />
      {tagOpen && (
        <BatchTagDialog
          count={selected.size}
          bookTags={bookTags}
          onClose={() => setTagOpen(false)}
          onApply={(tags) => {
            void useReaderStore.getState().addTagsToExcerpts(selectedIds, tags);
            toast("success", `已给 ${selectedIds.length} 条摘录加标签`);
            setTagOpen(false);
            exitSelect();
          }}
        />
      )}
    </div>
  );
}

function ExcerptCard({
  ex,
  bookTags,
  selectMode = false,
  checked = false,
  onToggle,
}: {
  ex: Excerpt;
  bookTags: string[];
  selectMode?: boolean;
  checked?: boolean;
  onToggle?: () => void;
}) {
  const book = useReaderStore((s) => s.book);
  const [editingTags, setEditingTags] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  const commitTags = () => {
    setEditingTags(false);
    const same = draft.length === (ex.tags?.length ?? 0) && draft.every((t) => ex.tags?.includes(t));
    if (!same) void useReaderStore.getState().updateExcerptTags(ex.id, draft);
  };

  // 点到编辑区之外（失焦）即视作保存，无需再点「保存」
  useEffect(() => {
    if (!editingTags) return;
    const onDown = (e: MouseEvent) => {
      if (editRef.current && !editRef.current.contains(e.target as Node)) commitTags();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTags, draft]);

  if (!book) return null;
  const label = ex.spine >= 0 ? chapterLabelFor(book, ex.spine) : "未定位";

  const startEdit = () => {
    setDraft(ex.tags ?? []);
    setEditingTags(true);
  };

  if (selectMode) {
    return (
      <div
        onClick={onToggle}
        className={`mb-2.5 flex cursor-pointer gap-2.5 rounded-xl border p-3.5 transition-colors ${
          checked ? "border-accent bg-accent-soft/40" : "border-line hover:border-ink-faint"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle?.()}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <div className="min-w-0 flex-1">
          <p className="border-l-2 border-accent pl-2 text-[13px] leading-relaxed text-ink">
            {truncate(ex.quote.replace(/\s+/g, " "), 120)}
          </p>
          {(ex.tags?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {ex.tags!.map((t) => (
                <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-ink-faint">
            {label} · {SOURCE_LABEL[ex.source]}
          </div>
        </div>
      </div>
    );
  }

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

      {editingTags ? (
        <div className="mt-2" ref={editRef}>
          <TagInput value={draft} onChange={setDraft} bookTags={bookTags} autoFocus />
          <div className="mt-1.5 flex justify-end gap-2 text-xs">
            <button onClick={() => setEditingTags(false)} className="text-ink-faint hover:text-ink">
              取消
            </button>
            <button onClick={commitTags} className="font-medium text-accent hover:opacity-80">
              保存
            </button>
          </div>
        </div>
      ) : (
        (ex.tags?.length ?? 0) > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {ex.tags!.map((t) => (
              <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                #{t}
              </span>
            ))}
          </div>
        )
      )}

      <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
        <span>
          {label} · {SOURCE_LABEL[ex.source]}
        </span>
        <span className="flex items-center gap-2.5">
          {!editingTags && (
            <button onClick={startEdit} className="hover:text-accent">
              {ex.tags?.length ? "改标签" : "标签"}
            </button>
          )}
          <button onClick={() => setExportOpen(true)} className="hover:text-accent">
            出图
          </button>
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
        </span>
      </div>
      {exportOpen && <ExcerptImageModal ex={ex} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function BatchTagDialog({
  count,
  bookTags,
  onApply,
  onClose,
}: {
  count: number;
  bookTags: string[];
  onApply: (tags: string[]) => void;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Modal open onClose={onClose} title={`批量打标签 · ${count} 条`}>
      <p className="mb-2 text-xs text-ink-faint">标签会追加到选中摘录，原有标签保留。</p>
      <TagInput value={tags} onChange={setTags} bookTags={bookTags} autoFocus />
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:border-accent hover:text-ink"
        >
          取消
        </button>
        <button
          onClick={() => onApply(tags)}
          disabled={!tags.length}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
        >
          加标签
        </button>
      </div>
    </Modal>
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
