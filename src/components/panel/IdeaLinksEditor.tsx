import { useState } from "react";
import { chapterLabelFor } from "../../services/ai/context";
import { ideaKey, type Idea, type IdeaLink } from "../../services/ideas/catalog";

export function IdeaLinksEditor({ card, catalog, topics, links, onChange, loading, error }: {
  card: Idea; catalog: Idea[]; topics: string[]; links: IdeaLink[]; onChange(links: IdeaLink[]): void;
  loading: boolean; error: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [query, setQuery] = useState("");
  const topic = topics.includes(selectedTopic) ? selectedTopic : topics[0] ?? "";
  const q = query.trim().toLocaleLowerCase();
  const candidates = catalog.filter(c => {
    if (ideaKey(c) === ideaKey(card)) return false;
    const text = [c.book.title, c.anno?.anchor?.quote, c.anno?.content, c.session?.title, c.session?.context.quote,
      ...(c.session?.turns.map(t => t.content) ?? []),
      ...((c.anno?.entries ?? c.session?.entries ?? []).map(entry => entry.content)), ...c.topics].filter(Boolean).join("\n");
    return !q || text.toLocaleLowerCase().includes(q);
  });
  const count = links.filter(l => topics.includes(l.topic)).length;
  return <div className="mt-2">
    <button type="button" aria-expanded={open} className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-accent hover:bg-accent-soft" onClick={() => setOpen(v => !v)}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" /></svg>
      链接{count > 0 ? ` · 待关联 ${count}` : ""}
    </button>
    {open && <div className="mt-1 rounded-lg border border-line bg-paper p-2.5">
      {!topics.length ? <p className="text-xs text-ink-faint">先输入一个话题，再链接其他想法卡。</p> : <>
        <label className="mb-2 block text-xs text-ink-soft">关联到话题
          <select aria-label="关联到话题" value={topic} onChange={e => setSelectedTopic(e.target.value)} className="mt-1 block w-full rounded-md border border-line bg-card px-2 py-1.5 text-xs">
            {topics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <input type="search" aria-label="跨书搜索想法卡" placeholder="搜索书名、原文或想法…" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-xs" />
        {loading && <p role="status" className="mt-2 text-xs text-ink-faint">正在读取其他书的想法…</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-2 max-h-56 overflow-y-auto">
          {candidates.map(c => {
            const already = c.topics.includes(topic);
            const checked = already || links.some(l => ideaKey(l.card) === ideaKey(c) && l.topic === topic);
            const text = c.anno?.content ?? c.session?.title ?? "";
            return <label key={ideaKey(c)} className={`mb-1 flex items-start gap-2 rounded-lg border border-line p-2 text-xs ${already ? "opacity-60" : "cursor-pointer hover:bg-accent-soft"}`}>
              <input type="checkbox" className="mt-0.5" checked={checked} disabled={already} onChange={e => onChange(e.target.checked ? [...links, { card: c, topic }] : links.filter(l => ideaKey(l.card) !== ideaKey(c) || l.topic !== topic))} />
              <span className="min-w-0"><span className="block text-ink-faint">{c.book.title} · {chapterLabelFor(c.book, c.anno?.spine ?? c.session!.context.spine)}{already ? " · 已关联" : ""}</span><span className="mt-1 block break-words text-ink-soft">{text.slice(0, 100)}{text.length > 100 ? "…" : ""}</span></span>
            </label>;
          })}
          {!loading && !candidates.length && <p className="py-2 text-xs text-ink-faint">没有找到其他想法卡。</p>}
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">保存后，选中的卡片也会关联到「{topic}」。</p>
      </>}
    </div>}
  </div>;
}
