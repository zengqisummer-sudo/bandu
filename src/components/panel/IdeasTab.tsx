import { useEffect, useMemo, useState } from "react";
import { useReaderStore } from "../../stores/readerStore";
import { useChatStore } from "../../stores/chatStore";
import { ideasForBook, readOtherIdeas, ideaKey, type Idea } from "../../services/ideas/catalog";
import { recordTopicUse } from "../../lib/topics";
import { IdeaCard } from "./IdeaCard";

export function IdeasTab() {
  const book = useReaderStore(s => s.book);
  const annotations = useReaderStore(s => s.annotations);
  const sessions = useChatStore(s => s.sessions);
  const [others, setOthers] = useState<Idea[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setOthers([]); setError("");
    if (!book) return;
    setLoading(true);
    void readOtherIdeas(book.id, controller.signal)
      .then(cards => { if (!controller.signal.aborted) setOthers(cards); })
      .catch(e => { if (!controller.signal.aborted) setError(`跨书话题读取失败：${String(e)}`); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [book?.id, revision]);
  const local = useMemo(() => book ? ideasForBook(book, annotations, sessions) : [], [book, annotations, sessions]);
  const catalog = useMemo(() => [...local, ...others], [local, others]);
  const topics = useMemo(() => [...new Set(catalog.flatMap(c => c.topics))].sort((a, b) => a.localeCompare(b)), [catalog]);
  useEffect(() => { recordTopicUse(topics); }, [topics]);
  return <div className="h-full overflow-y-auto px-5 py-3">
    <div className="mb-4 flex items-center justify-between text-xs"><span className="text-ink-faint">本书 · {local.length} 张想法卡</span><button className="text-accent" onClick={() => { const id = useChatStore.getState().newSession(); useReaderStore.getState().setFocus(id, "text"); }}>＋问AI</button></div>
    {error && <p role="alert" className="mb-3 text-xs text-red-600">{error}<button className="ml-2 underline" onClick={() => setRevision(v => v + 1)}>重试</button></p>}
    {local.map(card => <IdeaCard key={ideaKey(card)} card={card} catalog={catalog} availableTopics={topics} changed={() => setRevision(v => v + 1)} loading={loading} error={error} />)}
    {!local.length && <p className="mt-8 text-center text-xs text-ink-faint">本书还没有想法卡。选中文字后点「写想法」或「问AI」。</p>}
  </div>;
}
