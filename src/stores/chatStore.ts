import { create } from "zustand";
import type { ChatSession, ChatTurn, ConversationsFile } from "../types/models";
import { storage } from "../services/storage";
import { paths } from "../services/storage/paths";
import { beforeWindow, chapterLabelFor } from "../services/ai/context";
import { buildChatSystem, effectivePromptSet } from "../services/ai/prompts";
import { friendlyAiError, resolveAiConfig, streamChat } from "../services/ai/client";
import { appendChatTurnsMd } from "../services/product/markdown";
import { useReaderStore } from "./readerStore";
import { useSettingsStore } from "./settingsStore";
import { toast } from "./uiStore";
import { genId, nowIso, truncate } from "../lib/utils";

const MAX_HISTORY_TURNS = 20; // 超长会话只带最近轮次（SPEC §4.3）

let abortCtrl: AbortController | null = null;

interface ChatState {
  bookId: string | null;
  sessions: ChatSession[];
  lastWrittenSession?: string;
  activeId: string | null;
  pending: boolean;
  draft: string | null; // 流式中的 AI 回复
  load(bookId: string): Promise<void>;
  reset(): void;
  newSession(quote?: string): string;
  select(id: string): void;
  rename(id: string, title: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  send(text: string): Promise<boolean>;
  abort(): void;
}

export const useChatStore = create<ChatState>((set, get) => {
  async function persist() {
    const { bookId, sessions, lastWrittenSession } = get();
    if (!bookId) return;
    const file: ConversationsFile = { version: 1, sessions, lastWrittenSession };
    await storage().writeStateJson(paths.conversations(bookId), file);
  }

  return {
    bookId: null,
    sessions: [],
    lastWrittenSession: undefined,
    activeId: null,
    pending: false,
    draft: null,

    async load(bookId) {
      const file = await storage().readJson<ConversationsFile>("state", paths.conversations(bookId));
      set({
        bookId,
        sessions: file?.sessions ?? [],
        lastWrittenSession: file?.lastWrittenSession,
        activeId: file?.sessions.length ? file.sessions[file.sessions.length - 1].id : null,
        pending: false,
        draft: null,
      });
    },

    reset() {
      abortCtrl?.abort();
      set({ bookId: null, sessions: [], activeId: null, pending: false, draft: null, lastWrittenSession: undefined });
    },

    newSession(quote) {
      const { progress } = useReaderStore.getState();
      const session: ChatSession = {
        id: genId("s"),
        title: "新对话",
        createdAt: nowIso(),
        context: { spine: progress.spine, percent: progress.percent, quote },
        turns: [],
        lastSavedTurn: 0,
      };
      set((s) => ({ sessions: [...s.sessions, session], activeId: session.id }));
      void persist();
      return session.id;
    },

    select(id) {
      set({ activeId: id });
    },

    async rename(id, title) {
      set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title: title.trim() || x.title } : x)) }));
      await persist();
    },

    async deleteSession(id) {
      set((s) => {
        const remaining = s.sessions.filter((x) => x.id !== id);
        return {
          sessions: remaining,
          activeId:
            s.activeId === id ? (remaining.length ? remaining[remaining.length - 1].id : null) : s.activeId,
        };
      });
      await persist();
    },

    async send(text) {
      const content = text.trim();
      if (!content || get().pending) return false;
      const reader = useReaderStore.getState();
      const settingsState = useSettingsStore.getState();
      const book = reader.book;
      if (!book || !reader.bookId) return false;
      const cfg = resolveAiConfig(settingsState.settings);
      if (!cfg) {
        toast("error", "请先在设置中配置 AI 提供商与 API key");
        return false;
      }

      let session = get().sessions.find((x) => x.id === get().activeId);
      if (!session) {
        const id = get().newSession();
        session = get().sessions.find((x) => x.id === id)!;
      }
      const sessionId = session.id;

      // 首条消息自动作为会话标题
      if (session.turns.length === 0 && session.title === "新对话") {
        await get().rename(sessionId, truncate(content.replace(/\s+/g, " "), 16));
      }

      const userTurn: ChatTurn = { role: "user", content, t: nowIso() };
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, turns: [...x.turns, userTurn] } : x)),
        pending: true,
        draft: "",
      }));
      await persist();

      try {
        // 对话上下文边界 = 当前阅读位置（SPEC §4.3）：含当前段在内的之前文本
        const { progress } = useReaderStore.getState();
        const win = await beforeWindow(
          reader.bookId,
          { spine: progress.spine, para: progress.anchor.para + 1, offset: 0 },
          settingsState.settings.contextChars
        );
        const cur = get().sessions.find((x) => x.id === sessionId)!;
        const system = buildChatSystem({
          book,
          chapterLabel: chapterLabelFor(book, progress.spine),
          percent: progress.percent,
          beforeWindow: win,
          sessionQuote: cur.context.quote,
          promptSet: effectivePromptSet(settingsState.prompts, book.contentType),
        });
        const history = cur.turns.slice(-MAX_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content }));

        abortCtrl = new AbortController();
        let acc = "";
        for await (const chunk of streamChat(cfg, {
          system,
          messages: history,
          maxTokens: 2048,
          signal: abortCtrl.signal,
        })) {
          acc += chunk;
          set({ draft: acc });
        }
        if (!acc.trim()) throw new Error("模型没有返回内容");

        const aiTurn: ChatTurn = { role: "assistant", content: acc.trim(), t: nowIso() };
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, turns: [...x.turns, aiTurn] } : x)),
          draft: null,
        }));

        // 自动落盘（SPEC §1.5-4）：本轮往返追加进 对话.md
        const done = get().sessions.find((x) => x.id === sessionId)!;
        const header =
          done.lastSavedTurn === 0 ? "new" : get().lastWrittenSession !== sessionId ? "resume" : null;
        const newTurns = done.turns.slice(done.lastSavedTurn);
        try {
          await appendChatTurnsMd(book, done, newTurns, header);
          set((s) => ({
            sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, lastSavedTurn: x.turns.length } : x)),
            lastWrittenSession: sessionId,
          }));
        } catch (e) {
          console.error(e);
          toast("error", "对话已完成，但写入 markdown 失败（内容仍在应用内）");
        }
        await persist();
        return true;
      } catch (e) {
        // 失败：撤回本轮用户消息，文字由输入框恢复
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === sessionId ? { ...x, turns: x.turns.filter((t) => t !== userTurn) } : x
          ),
          draft: null,
        }));
        await persist();
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          toast("error", `对话失败：${friendlyAiError(e)}`);
        }
        return false;
      } finally {
        abortCtrl = null;
        set({ pending: false });
      }
    },

    abort() {
      abortCtrl?.abort();
    },
  };
});
