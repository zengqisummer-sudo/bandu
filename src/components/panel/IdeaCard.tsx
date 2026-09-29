import { useEffect, useRef, useState } from "react";
import { useReaderStore } from "../../stores/readerStore";
import { useChatStore } from "../../stores/chatStore";
import { toast } from "../../stores/uiStore";
import { jumpToIdea } from "../../stores/readingNavigation";
import { chapterLabelFor } from "../../services/ai/context";
import { appendIdeaEntry, ideaKey, removeIdea, saveIdea, type Idea, type IdeaLink } from "../../services/ideas/catalog";
import { Markdown } from "../common/Markdown";
import { TopicInput, type TopicInputHandle } from "../common/TopicInput";
import { ChatTab } from "./ChatTab";
import { IdeaLinksEditor } from "./IdeaLinksEditor";

function timestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).slice(-2)}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function IdeaCard({ card, catalog, availableTopics, changed, loading, error, linkedPreview = false }: {
  card: Idea; catalog: Idea[]; availableTopics: string[]; changed(): void;
  loading: boolean; error: string; linkedPreview?: boolean;
}) {
  const currentBook = useReaderStore(s => s.bookId);
  const focus = useReaderStore(s => s.focus);
  const activeId = useChatStore(s => s.activeId);
  const pending = useChatStore(s => s.pending);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draftTopics, setDraftTopics] = useState(card.topics);
  const [links, setLinks] = useState<IdeaLink[]>([]);
  const [text, setText] = useState(card.anno?.content ?? card.session?.title ?? "");
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addition, setAddition] = useState("");
  const [draftEntries, setDraftEntries] = useState(card.anno?.entries ?? card.session?.entries ?? []);
  const ref = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const topicInputRef = useRef<TopicInputHandle>(null);
  const local = currentBook === card.book.id;
  const focused = local && focus?.id === card.id;
  useEffect(() => {
    if (focused && focus?.source === "text" && !linkedPreview) {
      setExpanded(true);
      const frame = requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return () => cancelAnimationFrame(frame);
    }
  }, [focused, focus?.nonce, linkedPreview]);
  useEffect(() => {
    if (!menu) return;
    const closeOutside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menu]);
  const anchor = card.anno?.anchor ?? card.session?.anchor;
  const spine = card.anno?.spine ?? card.session!.context.spine;
  const quote = anchor?.quote ?? card.session?.context.quote;
  const createdAt = card.anno?.createdAt ?? card.session!.createdAt;
  const entries = card.anno?.entries ?? card.session?.entries ?? [];
  const related = catalog.filter(c => ideaKey(c) !== ideaKey(card) && c.topics.some(t => card.topics.includes(t)));
  const stacked = !linkedPreview && !showLinks && related.length > 0;
  const jump = () => { if (anchor || card.session) void jumpToIdea({ bookId: card.book.id, spine, para: anchor?.para ?? 0, id: card.id }); };
  const edit = () => {
    setText(card.anno?.content ?? card.session?.title ?? "");
    setDraftEntries(entries);
    setDraftTopics(card.topics); setLinks([]); setEditing(true); setMenu(false);
  };
  const save = async () => {
    if (!text.trim() || draftEntries.some(entry => !entry.content.trim()) || saving || pending) return;
    const topics = topicInputRef.current?.commit() ?? draftTopics;
    setSaving(true);
    try { await saveIdea(card, text, topics, links, draftEntries); setEditing(false); }
    catch (e) { toast("error", `保存失败：${String(e)}`); }
    finally { changed(); setSaving(false); }
  };
  const saveAddition = async () => {
    if (!addition.trim() || saving || pending) return;
    setSaving(true);
    try { await appendIdeaEntry(card, addition); setAddition(""); setAdding(false); }
    catch (e) { toast("error", `保存失败：${String(e)}`); }
    finally { changed(); setSaving(false); }
  };
  const remove = async () => {
    setMenu(false);
    if (pending || saving || !confirm("删除这张想法卡？Markdown 历史保留。")) return;
    setSaving(true);
    try { await removeIdea(card); }
    catch (e) { toast("error", String(e)); }
    finally { changed(); setSaving(false); }
  };
  return <section className={`idea-card-group ${menu ? "idea-menu-open" : ""}`}>
    <article ref={ref} tabIndex={0} aria-label={`${chapterLabelFor(card.book, spine)}的想法卡`} onClick={() => { if (!editing && !adding) jump(); }} onKeyDown={e => { if (e.target === e.currentTarget && e.key === "Enter" && !editing && !adding) jump(); }}
      className={`idea-card ${focused ? "idea-card-focused" : ""} ${stacked ? "idea-card-stacked" : ""}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs leading-relaxed text-ink-faint">{linkedPreview && <span className="mb-0.5 block text-[11px]">{card.book.title}</span>}{chapterLabelFor(card.book, spine)}</p>
        <div ref={menuRef} className="relative flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" && menu) { setMenu(false); triggerRef.current?.focus(); } }}>
          <button type="button" aria-label="编辑想法" title="编辑" className="idea-icon-button" disabled={pending || saving || adding} onClick={edit}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m15 4 5 5M4 20h16M5 15l-1 4 4-1L20 6a2.1 2.1 0 0 0-3-3Z" /></svg>
          </button>
          <button type="button" aria-label="追加想法" title="在同一段原文下追加想法" className="idea-icon-button" disabled={pending || saving || editing || adding} onClick={() => { setAdding(true); setMenu(false); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3v18M3 12h18" /></svg>
          </button>
          <button ref={triggerRef} type="button" aria-label="想法卡操作" aria-haspopup="true" aria-expanded={menu} className="rounded-md px-2 py-0.5 text-lg leading-none tracking-widest text-ink hover:bg-accent-soft focus-visible:outline-accent" onClick={() => setMenu(v => !v)}>···</button>
          {menu && <div className="absolute right-0 top-full z-30 mt-1 min-w-28 rounded-lg border border-line bg-card py-1 shadow-lg">
            <button className="idea-menu-item" disabled={pending || saving || adding} onClick={edit}>编辑</button>
            <button className="idea-menu-item" disabled={pending || saving} onClick={() => void remove()}>删除</button>
            {!linkedPreview && related.length > 0 && <button className="idea-menu-item" aria-expanded={showLinks} onClick={() => { setShowLinks(v => !v); setMenu(false); }}>{showLinks ? "收起链接" : "查看链接"}</button>}
          </div>}
        </div>
      </header>
      {card.topics.length > 0 && <div className="mb-4 space-y-1.5">{card.topics.map(topic => <div key={topic} className="idea-topic-index">{topic}</div>)}</div>}
      {quote && <blockquote className="mb-5 border-l-2 border-accent pl-3 text-[13px] leading-relaxed text-ink-soft">{quote}</blockquote>}
      {editing ? <div onClick={e => e.stopPropagation()}>
        <fieldset disabled={saving || pending} className="min-w-0">
          <p className="mb-1 text-xs text-ink-soft">话题</p>
          <TopicInput ref={topicInputRef} value={draftTopics} onChange={setDraftTopics} availableTopics={availableTopics} autoFocus placeholder="输入话题（跨书共享）" />
          <IdeaLinksEditor card={card} catalog={catalog} topics={draftTopics} links={links} onChange={setLinks} loading={loading} error={error} />
          <textarea aria-label={card.anno ? "想法内容" : "对话标题"} value={text} onChange={e => setText(e.target.value)} rows={card.anno ? 5 : 2} className="mt-3 w-full rounded-lg border border-line bg-paper p-2 text-sm" />
          {draftEntries.map((entry, index) => <label key={entry.id} className="mt-3 block text-xs text-ink-soft">追加想法 · {timestamp(entry.createdAt)}
            <textarea aria-label={`追加想法 ${index + 1}`} value={entry.content} onChange={e => setDraftEntries(items => items.map(item => item.id === entry.id ? { ...item, content: e.target.value } : item))} rows={3} className="mt-1 w-full rounded-lg border border-line bg-paper p-2 text-sm text-ink" />
          </label>)}
          <div className="mt-2 flex justify-end gap-3 text-xs"><button type="button" onClick={() => setEditing(false)}>取消</button><button type="button" disabled={!text.trim() || draftEntries.some(entry => !entry.content.trim())} onClick={() => void save()} className="text-accent">{saving ? "保存中…" : "保存"}</button></div>
        </fieldset>
      </div> : card.anno ? <Markdown text={card.anno.content} /> : <>
        <p className="text-sm">{card.session!.title}</p>
        <button className="mt-2 text-xs text-accent" aria-expanded={expanded} onClick={e => { e.stopPropagation(); setExpanded(!expanded); if (local && !pending) useChatStore.getState().select(card.id); }}>{expanded ? "收起对话" : `展开完整对话（${Math.ceil(card.session!.turns.length / 2)} 轮）`}</button>
        {expanded && <div className="mt-2" onClick={e => e.stopPropagation()}>{local && activeId === card.id && !linkedPreview ? <div className="h-[480px]"><ChatTab embedded /></div> : <>
          {card.session!.turns.map((t, i) => <div key={i} className="mb-2 rounded-lg border border-line p-2"><p className="mb-1 text-xs text-accent">{t.role === "user" ? "我" : "AI"}</p><Markdown text={t.content} /></div>)}
          <button disabled={pending} className="text-xs text-accent" onClick={() => { if (local && !linkedPreview) useChatStore.getState().select(card.id); else jump(); }}>继续对话</button>
        </>}</div>}
      </>}
      <div className="mt-4 text-right text-[11px] text-ink-faint">
        <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>{timestamp(createdAt)}</time>
      </div>
      {!editing && entries.map(entry => <div key={entry.id} className="mt-3 border-t border-dotted border-line pt-3">
        <Markdown text={entry.content} />
        <div className="mt-3 text-right text-[11px] text-ink-faint"><time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString()}>{timestamp(entry.createdAt)}</time></div>
      </div>)}
      {adding && <div className="mt-3 border-t border-dotted border-line pt-3" onClick={e => e.stopPropagation()}>
        <fieldset disabled={saving || pending}>
          <textarea autoFocus aria-label="新增想法内容" placeholder="写下另一条想法…" value={addition} onChange={e => setAddition(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-paper p-2 text-sm" />
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button type="button" onClick={() => { setAdding(false); setAddition(""); }}>取消</button>
            <button type="button" disabled={!addition.trim()} onClick={() => void saveAddition()} className="text-accent">{saving ? "保存中…" : "保存"}</button>
          </div>
        </fieldset>
      </div>}
      {stacked && <footer className="mt-3 text-[11px] text-ink-faint">{related.length} 张关联卡片</footer>}
      {stacked && <button type="button" className="idea-stack-toggle" aria-label={`展开 ${related.length} 张关联卡片`} title="展开关联卡片" aria-expanded={false} onClick={e => { e.stopPropagation(); setShowLinks(true); }} />}
    </article>
    {showLinks && !linkedPreview && <div className="idea-linked-cards">
      <div className="mb-3 flex justify-between text-xs text-ink-faint"><span>关联卡片 · {related.length}</span><button className="hover:text-ink" onClick={() => setShowLinks(false)}>收起</button></div>
      {loading && <p className="mb-3 text-xs text-ink-faint">正在读取跨书链接…</p>}
      {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}</p>}
      {!loading && !related.length && <p className="mb-3 text-xs text-ink-faint">还没有关联卡片。可在编辑中添加话题并链接。</p>}
      {related.map(c => <IdeaCard key={ideaKey(c)} card={c} catalog={catalog} availableTopics={availableTopics} changed={changed} loading={loading} error={error} linkedPreview />)}
    </div>}
  </section>;
}
