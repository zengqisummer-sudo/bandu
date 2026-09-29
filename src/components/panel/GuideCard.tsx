import { useState } from "react";
import type { Annotation } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { Markdown } from "../common/Markdown";
function AnnoEditor({ anno, onDone }: { anno: Annotation; onDone: () => void }) {
  const [text, setText] = useState(anno.content);
  const save = () => {
    void useReaderStore.getState().editAnnotation(anno.id, text);
    onDone();
  };
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          if (e.key === "Escape") onDone();
        }}
        rows={5}
        className="w-full resize-y rounded-lg border border-line bg-paper p-2 text-sm text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-ink-faint">改动追加存档到 Obsidian（Ctrl+Enter 保存）</span>
        <div className="flex gap-2">
          <button onClick={onDone} className="rounded-lg px-3 py-1.5 text-xs text-ink-faint hover:text-ink">
            取消
          </button>
          <button
            onClick={save}
            disabled={!text.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-30"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function NoteCard({ anno, streamText }: { anno: Annotation; streamText?: string }) {
  const isStreaming = streamText != null;
  const [editing, setEditing] = useState(false);
  return (
    <div className="mb-3 rounded-xl border border-line bg-accent-soft/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-accent">▧ 本章导读</span>
        {!isStreaming && !editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-ink-faint hover:text-ink"
              title="编辑导读（改动单向同步到 Obsidian）"
            >
              编辑
            </button>
            <button
              onClick={() => void useReaderStore.getState().generateChapterNote(true)}
              className="text-xs text-ink-faint hover:text-ink"
              title="重新生成（旧版本保留在 markdown 中）"
            >
              重新生成
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <AnnoEditor anno={anno} onDone={() => setEditing(false)} />
      ) : (
        <Markdown text={isStreaming ? streamText : anno.content} streaming={isStreaming} />
      )}
    </div>
  );
}

