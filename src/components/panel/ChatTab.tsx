import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { resolveAiConfig } from "../../services/ai/client";
import { Markdown } from "../common/Markdown";
import { truncate } from "../../lib/utils";

export function ChatTab() {
  const sessions = useChatStore((s) => s.sessions);
  const activeId = useChatStore((s) => s.activeId);
  const pending = useChatStore((s) => s.pending);
  const draft = useChatStore((s) => s.draft);
  const settings = useSettingsStore((s) => s.settings);
  const openSettings = useUiStore((s) => s.openSettings);
  const [text, setText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const aiReady = !!resolveAiConfig(settings);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.turns.length, draft]);

  const send = async () => {
    const t = text.trim();
    if (!t || pending) return;
    setText("");
    const ok = await useChatStore.getState().send(t);
    if (!ok) setText(t); // 失败恢复输入
  };

  return (
    <div className="flex h-full flex-col">
      {/* 会话选择 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-2">
        <select
          value={activeId ?? ""}
          onChange={(e) => useChatStore.getState().select(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2 py-1.5 text-xs"
        >
          {!sessions.length && <option value="">（还没有对话）</option>}
          {[...sessions].reverse().map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}（{Math.ceil(s.turns.length / 2)} 轮）
            </option>
          ))}
        </select>
        {active && (
          <>
            <IconBtn
              title="重命名"
              onClick={() => {
                const name = prompt("会话标题：", active.title);
                if (name?.trim()) void useChatStore.getState().rename(active.id, name);
              }}
            >
              ✎
            </IconBtn>
            <IconBtn
              title="删除会话（markdown 中已写入的记录保留）"
              onClick={() => {
                if (confirm("删除这个会话？（markdown 中已落盘的内容保留）"))
                  void useChatStore.getState().deleteSession(active.id);
              }}
            >
              🗑
            </IconBtn>
          </>
        )}
        <button
          onClick={() => useChatStore.getState().newSession()}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-paper hover:opacity-90"
        >
          ＋新对话
        </button>
      </div>

      {/* 消息流 */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!active ? (
          <p className="mt-8 text-center text-xs leading-relaxed text-ink-faint">
            随时就已读内容发起讨论
            <br />
            也可以在正文选中文字后点「提问」
          </p>
        ) : (
          <>
            {active.context.quote && (
              <p className="mb-3 rounded-lg bg-accent-soft/60 px-3 py-2 text-xs text-ink-soft">
                💬 就这段发起：「{truncate(active.context.quote.replace(/\s+/g, " "), 50)}」
              </p>
            )}
            {active.turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="mb-3 flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-sm leading-relaxed">
                    {t.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="mb-3">
                  <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-line px-3.5 py-2.5">
                    <Markdown text={t.content} />
                  </div>
                </div>
              )
            )}
            {draft != null && (
              <div className="mb-3">
                <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-line px-3.5 py-2.5">
                  <Markdown text={draft} streaming />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-line p-2.5">
        {!aiReady ? (
          <p className="py-1 text-center text-xs text-ink-faint">
            需要先配置 AI
            <button onClick={openSettings} className="ml-1 text-accent underline">
              去设置
            </button>
          </p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="就已读内容提问、讨论…（Enter 发送，Shift+Enter 换行）"
              className="min-w-0 flex-1 resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent"
            />
            {pending ? (
              <button
                onClick={() => useChatStore.getState().abort()}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm text-ink-soft hover:bg-accent-soft"
              >
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!text.trim()}
                className="shrink-0 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
              >
                发送
              </button>
            )}
          </div>
        )}
        <p className="mt-1.5 px-1 text-[10px] text-ink-faint">对话自动写入 对话.md（每轮完成后追加）</p>
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="shrink-0 rounded-md px-1.5 py-1 text-xs text-ink-faint hover:bg-accent-soft hover:text-ink"
    >
      {children}
    </button>
  );
}
