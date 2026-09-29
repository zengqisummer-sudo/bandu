import type { Annotation, AnnotationsFile, BookMeta, ChatSession, ConversationsFile, IdeaEntry } from "../../types/models";
import { genId, nowIso } from "../../lib/utils";
import { ideaTopics, recordTopicUse, topicLine } from "../../lib/topics";
import { useReaderStore } from "../../stores/readerStore";
import { useChatStore } from "../../stores/chatStore";
import { toast } from "../../stores/uiStore";
import { storage } from "../storage";
import { paths } from "../storage/paths";
import { appendAnnotationMd } from "../product/markdown";

export interface Idea {
  book: BookMeta;
  id: string;
  topics: string[];
  anno?: Annotation;
  session?: ChatSession;
}
export interface IdeaLink { card: Idea; topic: string }

export const ideaKey = (card: Idea) => `${card.book.id}:${card.id}`;
export function ideasForBook(book: BookMeta, annotations: Annotation[], sessions: ChatSession[]): Idea[] {
  return [
    ...annotations.filter(a => a.kind === "passage" && a.source === "user").map(anno => ({ book, id: anno.id, topics: ideaTopics(anno), anno })),
    ...sessions.map(session => ({ book, id: session.id, topics: ideaTopics(session), session })),
  ];
}

export async function readOtherIdeas(excludeBookId: string, signal: AbortSignal): Promise<Idea[]> {
  const result: Idea[] = [];
  const provider = storage();
  for (const path of await provider.listStatePaths("books")) {
    if (signal.aborted) return [];
    if (!path.endsWith("/book.json")) continue;
    const book = await provider.readJson<BookMeta>("state", path);
    if (!book || book.id === excludeBookId) continue;
    const [a, c] = await Promise.all([
      provider.readJson<AnnotationsFile>("state", paths.annotations(book.id)),
      provider.readJson<ConversationsFile>("state", paths.conversations(book.id)),
    ]);
    result.push(...ideasForBook(book, a?.items ?? [], c?.sessions ?? []));
  }
  return result;
}

// Serialize edits of cards linked across books; each write re-reads the target state.
let writes: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = writes.catch(() => {}).then(job);
  writes = next;
  return next;
}

async function updateIdea(card: Idea, edit: { text?: string; topics?: string[]; addTopic?: string; appendEntry?: IdeaEntry; entries?: IdeaEntry[] }): Promise<void> {
  const provider = storage();
  if (useChatStore.getState().pending) throw new Error("AI 正在回复，请完成后再保存关联");
  const topicsFor = (value: { topics?: string[]; tags?: string[] }) =>
    [...new Set([...(edit.topics ?? ideaTopics(value)), ...(edit.addTopic ? [edit.addTopic] : [])])];
  const entriesFor = (value: { entries?: IdeaEntry[] }) => {
    const entries = (value.entries ?? []).map(entry => {
      const updated = edit.entries?.find(e => e.id === entry.id);
      return updated ? { ...entry, content: updated.content.trim() } : entry;
    });
    return edit.appendEntry ? [...entries, edit.appendEntry] : entries;
  };
  if (card.anno) {
    const path = paths.annotations(card.book.id);
    const reader = useReaderStore.getState();
    const file = reader.bookId === card.book.id
      ? { version: 1 as const, items: reader.annotations }
      : await provider.readJson<AnnotationsFile>("state", path);
    const old = file?.items.find(a => a.id === card.id);
    if (!file || !old) throw new Error(`《${card.book.title}》中的想法已不存在`);
    const next = { ...old, content: edit.text ?? old.content, topics: topicsFor(old), entries: entriesFor(old) };
    await provider.writeStateJson(path, { ...file, items: file.items.map(a => a.id === card.id ? next : a) });
    if (useReaderStore.getState().bookId === card.book.id) {
      useReaderStore.setState(s => ({ annotations: s.annotations.map(a => a.id === card.id ? next : a) }));
    }
    recordTopicUse(next.topics);
    try { await appendAnnotationMd(card.book, next); }
    catch { toast("error", "想法已保存，但 Markdown 追加失败，请检查产物文件夹权限"); }
  } else {
    const path = paths.conversations(card.book.id);
    const chat = useChatStore.getState();
    const file = chat.bookId === card.book.id
      ? { version: 1 as const, sessions: chat.sessions, lastWrittenSession: chat.lastWrittenSession }
      : await provider.readJson<ConversationsFile>("state", path);
    const old = file?.sessions.find(s => s.id === card.id);
    if (!file || !old) throw new Error(`《${card.book.title}》中的会话已不存在`);
    const next = { ...old, title: edit.text ?? old.title, topics: topicsFor(old), entries: entriesFor(old) };
    await provider.writeStateJson(path, { ...file, sessions: file.sessions.map(s => s.id === card.id ? next : s) });
    if (useChatStore.getState().bookId === card.book.id) {
      useChatStore.setState(s => ({ sessions: s.sessions.map(a => a.id === card.id ? next : a) }));
    }
    recordTopicUse(next.topics);
    try {
      const entries = edit.appendEntry ? [edit.appendEntry] : edit.entries ? next.entries : [];
      const body = entries.map(entry => `\n### 追加想法 · ${entry.createdAt}\n\n${entry.content}\n`).join("");
      await provider.appendMarkdown(paths.productIdeas(card.book.productDir), `\n---\n\n## ${next.title} · 想法更新\n<!-- idea ${card.id} -->\n${topicLine(next.topics)}\n${body}`, "# 想法\n");
    } catch { toast("error", "话题已保存，但 Markdown 追加失败，请检查产物文件夹权限"); }
  }
}

export function appendIdeaEntry(card: Idea, text: string): Promise<void> {
  if (!text.trim()) return Promise.reject(new Error("请输入想法内容"));
  return enqueue(() => updateIdea(card, { appendEntry: { id: genId("idea"), content: text.trim(), createdAt: nowIso() } }));
}

export function saveIdea(card: Idea, text: string, topics: string[], links: IdeaLink[], entries?: IdeaEntry[]): Promise<void> {
  return enqueue(async () => {
    await updateIdea(card, { text: text.trim(), topics, entries });
    for (const link of links) {
      if (!topics.includes(link.topic) || ideaKey(link.card) === ideaKey(card)) continue;
      try { await updateIdea(link.card, { addTopic: link.topic }); }
      catch (e) { throw new Error(`本卡已保存，关联《${link.card.book.title}》失败：${String(e)}。可再次保存重试。`); }
    }
  });
}

export function removeIdea(card: Idea): Promise<void> {
  return enqueue(async () => {
    if (useChatStore.getState().pending) throw new Error("AI 正在回复，请完成后再删除");
    if (card.anno) {
      if (useReaderStore.getState().bookId === card.book.id) await useReaderStore.getState().removeAnnotation(card.id);
      else {
        const path = paths.annotations(card.book.id);
        const file = await storage().readJson<AnnotationsFile>("state", path);
        if (file) await storage().writeStateJson(path, { ...file, items: file.items.filter(a => a.id !== card.id) });
      }
    } else if (useChatStore.getState().bookId === card.book.id) await useChatStore.getState().deleteSession(card.id);
    else {
      const path = paths.conversations(card.book.id);
      const file = await storage().readJson<ConversationsFile>("state", path);
      if (file) await storage().writeStateJson(path, { ...file, sessions: file.sessions.filter(s => s.id !== card.id) });
    }
  });
}
