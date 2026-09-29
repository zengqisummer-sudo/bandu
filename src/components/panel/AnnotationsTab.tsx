import { useEffect, useRef, useState } from "react";
import type { Anchor, Footnote } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { useFootnoteStore } from "../../stores/footnoteStore";
import { useUiStore } from "../../stores/uiStore";
import { loadChapter } from "../../services/epub/parse";
import { chapterLabelFor } from "../../services/ai/context";
import { Markdown } from "../common/Markdown";
import { findFootnoteLocations, type FootnoteLocation } from "../../services/hints/locations";
import { jumpToPassage } from "../../stores/passageNavigation";
import { footnotePageLabel } from "../../services/epub/pages";
import { toast } from "../../stores/uiStore";
import { NoteCard } from "./GuideCard";

export function AnnotationsTab() {
  const book = useReaderStore(s => s.book);
  const chapter = useReaderStore(s => s.chapter);
  const annotations = useReaderStore(s => s.annotations);
  const streaming = useReaderStore(s => s.streaming);
  const hints = useReaderStore(s => s.hints);
  const focus = useReaderStore(s => s.focus);
  const render = useReaderStore(s => s.hintRender);
  const { items, bookGuide, busy, guideError, ready } = useFootnoteStore();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"text" | "note">("note");
  const [results, setResults] = useState<{ spine: number; para: number; text: string; anchor: Anchor }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [resultIndex, setResultIndex] = useState(0);
  useEffect(() => { if (focus?.source === "text") setQuery(""); }, [focus?.nonce]);
  useEffect(() => {
    let cancelled = false;
    setResults([]); setResultIndex(0); setSearchError(""); setSearching(false);
    if (!book || mode !== "text" || !query.trim()) return;
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        const found: typeof results = [];
        for (let spine = 0; spine < book.spineLength; spine++) {
          if (cancelled) return;
          const c = await loadChapter(book.id, spine);
          c.paras.forEach((text, para) => {
            const needle = query.trim().toLocaleLowerCase();
            const haystack = text.toLocaleLowerCase();
            for (let start = haystack.indexOf(needle); start >= 0; start = haystack.indexOf(needle, start + Math.max(needle.length, 1))) {
              found.push({ spine, para, text, anchor: { para, start, endPara: para, end: start + needle.length, quote: text.slice(start, start + needle.length), prefix: text.slice(Math.max(0, start - 20), start), suffix: text.slice(start + needle.length, start + needle.length + 20) } });
            }
          });
        }
        if (!cancelled) setResults(found);
      })().catch(e => { if (!cancelled) setSearchError(String(e)); }).finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [book, mode, query]);
  if (!book || !chapter) return null;
  const note = [...annotations].reverse().find(a => a.kind === "chapter" && a.spine === chapter.spine);
  const blocks = hints?.hints.filter(h => h.kind === "block") ?? [];
  const filtered = items.filter(n => mode !== "note" || !query.trim() || n.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const jumpResult = (index: number) => { const r = results[index]; if (r) { setResultIndex(index); void jumpToPassage(r.spine, r.anchor); } };
  return <div data-annotations-scroll className="flex h-full flex-col overflow-y-auto p-3">
    <details open className="mb-3 rounded-xl border border-line bg-accent-soft/50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-accent">全书导读</summary>
      <div className="mt-3">{bookGuide ? <Markdown text={bookGuide} /> : <p className="text-xs text-ink-faint">搜索网络资料，了解作者与写作背景。</p>}</div>
      {guideError && <p role="alert" className="mt-2 text-xs text-red-600">{guideError}</p>}
      <div className="mt-2 flex justify-end gap-3 text-xs"><button onClick={() => useUiStore.getState().openSettings()} className="text-ink-faint">联网设置</button><button disabled={busy || !ready} onClick={() => void useFootnoteStore.getState().generateGuide()} className="text-accent disabled:opacity-40">{busy ? "搜索并生成中…" : bookGuide ? "重新生成" : "生成全书导读"}</button></div>
    </details>
    <details open className="mb-3 rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-xs font-semibold text-accent">章节导读 · {chapterLabelFor(book, chapter.spine)}</summary>
      <div className="mt-3">{note ? <NoteCard anno={note} streamText={streaming[note.id]} /> : <button className="rounded-lg bg-accent px-3 py-1.5 text-xs text-paper" onClick={() => void useReaderStore.getState().generateChapterNote(true)}>生成本章导读</button>}</div>
      {blocks.map(h => <div key={h.id} className="mt-2 rounded-lg bg-accent-soft/40 p-2 text-xs"><Markdown text={h.text} /></div>)}
    </details>
    <div className="mb-3 rounded-xl border border-line p-3">
      <p className="mb-2 text-xs font-semibold text-accent">查找注释</p>
      <div className="flex gap-2"><select aria-label="查找范围" className="rounded-lg border border-line bg-paper p-1 text-xs" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="note">注释</option><option value="text">原文</option></select><input aria-label="查找关键词" value={query} onChange={e => setQuery(e.target.value)} placeholder={mode === "note" ? "全书注释内容…" : "全书原文…"} className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1 text-xs" />{query && <button className="text-xs text-ink-faint" onClick={() => setQuery("")}>清除</button>}</div>
      {mode === "text" && query.trim() && <div className="mt-2 text-xs">
        {searching ? "正在查找…" : searchError ? <span className="text-red-600">{searchError}</span> : <><div className="flex justify-between"><span>{results.length} 处匹配</span><span><button disabled={!results.length} onClick={() => jumpResult((resultIndex - 1 + results.length) % results.length)}>上一处</button> · <button disabled={!results.length} onClick={() => jumpResult((resultIndex + 1) % results.length)}>下一处</button></span></div><div className="mt-2 max-h-64 overflow-auto">{results.map((r, i) => <button key={`${r.spine}:${r.para}:${r.anchor.start}`} onClick={() => jumpResult(i)} className={`mb-1 block w-full rounded-lg p-2 text-left ${i === resultIndex ? "bg-accent-soft" : "hover:bg-accent-soft/40"}`}><span className="text-ink-faint">{chapterLabelFor(book, r.spine)} · </span>{r.text.slice(Math.max(0, r.anchor.start - 25), Math.max(0, r.anchor.start - 25) + 150)}</button>)}</div></>}
      </div>}
    </div>
    <p className="mb-2 text-xs text-ink-faint">随文注释 · {filtered.length} 条{render ? ` · 本章已定位 ${render.anchored.length}/${render.total}` : ""}</p>
    {!ready && <p className="text-xs text-ink-faint">正在读取注释…</p>}
    {filtered.map(n => <FootnoteCard key={n.id} note={n} missed={render?.missed.includes(n.id) ?? false} />)}
    {ready && !filtered.length && <p className="mt-3 text-center text-xs text-ink-faint">{query ? "没有匹配的注释" : "在正文选中文字，点击「注释」开始书写。"}</p>}
  </div>;
}

function FootnoteCard({ note, missed }: { note: Footnote; missed: boolean }) {
  const book = useReaderStore(s => s.book);
  const items = useFootnoteStore(s => s.items);
  const [locations, setLocations] = useState<FootnoteLocation[] | null>(null);
  const [current, setCurrent] = useState(-1);
  const [locating, setLocating] = useState(false);
  const version = useRef(0);
  const [pageLabel, setPageLabel] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPageLabel("");
    const card = ref.current;
    if (!book || !card) return;
    // Compute only visible/nearby cards; remounting the tab reuses completed labels.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void footnotePageLabel(book, note, controller.signal).then(label => {
        if (!controller.signal.aborted) setPageLabel(label);
      }).catch(() => { /* Keep the chapter fallback; failed lookups are retryable. */ });
    }, { root: card.closest("[data-annotations-scroll]"), rootMargin: "160px" });
    observer.observe(card);
    return () => { observer.disconnect(); controller.abort(); };
  }, [book, note]);
  useEffect(() => { ++version.current; setLocations(null); setCurrent(-1); setLocating(false); return () => { ++version.current; }; }, [book?.id, note, items]);
  const navigate = async (next = false) => {
    if (!book || locating) return;
    const token = ++version.current;
    setLocating(true);
    try {
      const found = locations ?? await findFootnoteLocations(book, note, items, () => token !== version.current);
      if (token !== version.current) return;
      setLocations(found);
      if (!found.length) { toast("info", "未找到原文位置，注释已保留"); return; }
      const original = found.findIndex(l => l.spine === note.spine && (!note.target.prefix || note.target.prefix.endsWith(l.anchor.prefix) || l.anchor.prefix.endsWith(note.target.prefix)) && (!note.target.suffix || note.target.suffix.startsWith(l.anchor.suffix) || l.anchor.suffix.startsWith(note.target.suffix)));
      const index = next ? (current + 1) % found.length : Math.max(0, original);
      setCurrent(index);
      await jumpToPassage(found[index].spine, found[index].anchor, note.id);
    } catch (e) { if (token === version.current) toast("error", `定位失败：${String(e)}`); }
    finally { if (token === version.current) setLocating(false); }
  };
  const focus = useReaderStore(s => s.focus);
  const editing = useFootnoteStore(s => s.editingId === note.id);
  const [text, setText] = useState(note.text);
  const [sync, setSync] = useState(note.sync);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) { setText(note.text); setSync(note.sync); } }, [editing, note]);
  useEffect(() => { if (focus?.id === note.id) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [focus, note.id]);
  const save = async () => {
    setSaving(true);
    try { if (await useFootnoteStore.getState().save({ ...note, text: text.trim(), sync })) useFootnoteStore.getState().edit(null); }
    finally { setSaving(false); }
  };
  return <div ref={ref} role={editing ? undefined : "button"} tabIndex={editing ? undefined : 0} aria-label="跳转到注释原文" onClick={e => { if (!editing && !(e.target as HTMLElement).closest("button, a, input, textarea")) void navigate(); }} onKeyDown={e => { if (!editing && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); void navigate(); } }} className={`mb-2.5 rounded-xl border p-3.5 ${focus?.id === note.id ? "border-accent bg-accent-soft/40" : "border-line"}`}>
    <p className="mb-2 border-l-2 border-accent pl-2 text-xs text-ink-soft">{note.target.exact}</p>
    {missed && <p className="mb-2 text-xs text-amber-600">本章未定位，注释已保留。</p>}
    {editing ? <><textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={5} className="w-full rounded-lg border border-line bg-paper p-2 text-sm" /><label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />同步全文（已有独立注释不覆盖）</label><div className="mt-2 flex justify-end gap-3 text-xs"><button onClick={() => useFootnoteStore.getState().edit(null)}>取消</button><button disabled={!text.trim() || saving} onClick={() => void save()} className="text-accent">{saving ? "保存中…" : "保存"}</button></div></> : <><Markdown text={note.text} /><div className="mt-2 flex items-center justify-between text-xs text-ink-faint"><span>{pageLabel || (book ? chapterLabelFor(book, note.spine) : "")}{note.sync ? "等" : ""}</span><span className="flex items-center gap-3">{locating ? <span role="status">定位中…</span> : note.sync && current >= 0 && <><span>{current + 1}/{locations?.length}</span><button onClick={() => void navigate(true)}>下一个</button></>}<button onClick={() => useFootnoteStore.getState().edit(note.id)}>编辑</button><button onClick={() => void useFootnoteStore.getState().remove(note.id)}>删除</button></span></div></>}
  </div>;
}
