import { useEffect, useRef, useState } from "react";
import type { Annotation, Hint } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { resolveAiConfig } from "../../services/ai/client";
import { chapterLabelFor } from "../../services/ai/context";
import { noteTypeClass, noteTypeLabel } from "../../services/hints/noteTypes";
import { Markdown } from "../common/Markdown";
import { truncate } from "../../lib/utils";

export function AnnotationsTab() {
  const chapter = useReaderStore((s) => s.chapter);
  const annotations = useReaderStore((s) => s.annotations);
  const streaming = useReaderStore((s) => s.streaming);
  const book = useReaderStore((s) => s.book);
  const settings = useSettingsStore((s) => s.settings);
  const openSettings = useUiStore((s) => s.openSettings);

  if (!chapter || !book) return null;
  const spine = chapter.spine;
  const aiReady = !!resolveAiConfig(settings);

  const note = [...annotations].reverse().find((a) => a.kind === "chapter" && a.spine === spine);
  const passages = annotations
    .filter((a) => a.kind === "passage" && a.spine === spine)
    .sort((a, b) => (a.anchor?.para ?? 0) - (b.anchor?.para ?? 0) || (a.anchor?.start ?? 0) - (b.anchor?.start ?? 0));
  const others = annotations.filter((a) => a.spine !== spine);

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      {/* 章节导读卡片 */}
      {note ? (
        <NoteCard anno={note} streamText={streaming[note.id]} />
      ) : aiReady ? (
        <div className="mb-3 rounded-xl border border-dashed border-line p-4 text-center">
          <p className="text-xs text-ink-faint">本章还没有导读</p>
          <button
            onClick={() => void useReaderStore.getState().generateChapterNote(true)}
            className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90"
          >
            生成本章导读
          </button>
        </div>
      ) : (
        <div className="mb-3 rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-faint">
          配置 AI 后可生成章节导读、随文注释与深挖注释
          <button onClick={openSettings} className="ml-1 text-accent underline">
            去设置
          </button>
        </div>
      )}

      {/* 随文注释（hints） */}
      {aiReady && <HintsSection />}

      {/* 段落注释 */}
      {passages.length === 0 && !passages.some((p) => streaming[p.id] != null) ? (
        <p className="mt-4 px-1 text-center text-xs leading-relaxed text-ink-faint">
          在正文中选中一段文字，点「深挖」或「批注」
          <br />
          注释会锚定在原文上
        </p>
      ) : (
        passages.map((a) => <PassageCard key={a.id} anno={a} streamText={streaming[a.id]} />)
      )}

      {/* 手写本章批注（不锚定原文） */}
      <ManualNoteBox />

      {/* 其他章节的注释 */}
      {others.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer px-1 text-xs text-ink-faint hover:text-ink">
            其他章节的注释（{others.length}）
          </summary>
          <div className="mt-2">
            {others.map((a) => (
              <button
                key={a.id}
                onClick={() => void useReaderStore.getState().openSpine(a.spine, a.anchor?.para ?? 0)}
                className="mb-1 block w-full rounded-lg border border-line px-3 py-2 text-left text-xs text-ink-soft hover:bg-accent-soft"
              >
                <span className="text-ink-faint">{chapterLabelFor(book, a.spine)}</span>
                <span className="mx-1">·</span>
                {a.kind === "chapter"
                  ? "章节导读"
                  : a.anchor
                    ? truncate(a.anchor.quote.replace(/\s+/g, " "), 18)
                    : a.source === "user"
                      ? `我的批注：${truncate(a.content.replace(/\s+/g, " "), 12)}`
                      : "注释"}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * 随文注释区（ANNOTATION_SPEC §6）：生成入口、匹配率、未锚定兜底列表。
 * 未锚定的 hint 绝不静默丢弃——在这里按章节级列表展示。
 */
function HintsSection() {
  const chapter = useReaderStore((s) => s.chapter);
  const hints = useReaderStore((s) => s.hints);
  const hintRender = useReaderStore((s) => s.hintRender);
  const generatingSpine = useReaderStore((s) => s.hintsGeneratingSpine);
  const progress = useReaderStore((s) => s.hintsProgress);
  const hintsError = useReaderStore((s) => s.hintsError);
  const showHints = useUiStore((s) => s.showHints);
  const setShowHints = useUiStore((s) => s.setShowHints);

  if (!chapter) return null;
  const spine = chapter.spine;
  const generating = generatingSpine === spine;
  const file = hints && hints.metadata.spine === spine ? hints : null;
  const render = hintRender && hintRender.spine === spine ? hintRender : null;
  const error = !generating && hintsError?.spine === spine ? hintsError : null;

  if (generating) {
    return (
      <div className="mb-3 rounded-xl border border-line p-4">
        <span className="text-xs font-semibold tracking-wide text-accent">✦ 随文注释</span>
        <p className="stream-cursor mt-2 text-xs text-ink-soft">正在通读本章、逐处作注…（已接收 {progress} 字）</p>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="mb-3 rounded-xl border border-dashed border-line p-4 text-center">
        <p className="text-xs text-ink-faint">本章还没有随文注释（注入正文的行内批注）</p>
        <button
          onClick={() => void useReaderStore.getState().generateChapterHints()}
          className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-paper hover:opacity-90"
        >
          {error ? "重试" : "生成本章随文注释"}
        </button>
        {!error && <p className="mt-1.5 text-[11px] text-ink-faint">整章送入 AI，按需生成，可随时重来</p>}
        {error && <HintsErrorDetail error={error} />}
      </div>
    );
  }

  const missedHints: Hint[] = render ? file.hints.filter((h) => render.missed.includes(h.id)) : [];
  const okRate = render ? `${render.anchored.length}/${render.total}` : null;

  return (
    <div className="mb-3 rounded-xl border border-line p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-accent">✦ 随文注释 · {file.hints.length} 条</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHints(!showHints)}
            className="text-xs text-ink-faint hover:text-ink"
            title={showHints ? "从正文中隐藏随文注释" : "把随文注释注入正文显示"}
          >
            {showHints ? "隐藏" : "显示"}
          </button>
          <button
            onClick={() => void useReaderStore.getState().generateChapterHints()}
            className="text-xs text-ink-faint hover:text-ink"
            title="重新生成（整份替换；markdown 存档保留历史）"
          >
            重新生成
          </button>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-ink-faint">
        {render ? (
          <>
            已锚定{" "}
            <span className={render.missed.length === 0 ? "text-green-600" : "text-amber-600"}>{okRate}</span>
            {showHints ? "，标注已注入正文，点击虚线短语查看" : "（当前隐藏，未注入正文）"}
          </>
        ) : (
          "正文定位中…"
        )}
        {file.metadata.truncated && <>；本章超长，注释仅覆盖前 {file.metadata.sourceChars} 字</>}
      </p>

      {error && <HintsErrorDetail error={error} />}

      {missedHints.length > 0 && (
        <div className="mt-2.5 border-t border-line pt-2">
          <p className="mb-1.5 text-[11px] text-ink-faint">
            以下 {missedHints.length} 条未能在正文中锚定（引文与原文有出入），列在这里兜底：
          </p>
          {missedHints.map((h) => (
            <div key={h.id} className="mb-1.5 rounded-lg bg-accent-soft/40 px-2.5 py-2">
              <p className="text-[11px] leading-relaxed text-ink-soft">
                <span className={`hint-badge hint-nt-${noteTypeClass(h.note_type)} mr-1.5`}>
                  {noteTypeLabel(h.note_type)}
                </span>
                「{truncate(h.target.exact.replace(/\s+/g, " "), 24)}」
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink">{h.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 生成失败诊断：报错原因 + 模型原始输出（可展开复制，便于排查是格式问题还是别的） */
function HintsErrorDetail({ error }: { error: { message: string; raw: string } }) {
  return (
    <div className="mt-2 rounded-lg bg-red-500/5 px-2.5 py-2 text-left">
      <p className="text-[11px] leading-relaxed text-red-600">上次生成失败：{error.message}</p>
      {error.raw.trim() && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-ink-faint hover:text-ink">
            查看模型原始输出（{error.raw.length} 字）
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-paper p-2 text-[11px] leading-relaxed text-ink-soft">
            {error.raw}
          </pre>
        </details>
      )}
    </div>
  );
}

/** 手写本章批注入口（不锚定原文；锚定的批注走正文选中 → 「批注」） */
function ManualNoteBox() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-ink-faint hover:border-ink-faint hover:text-ink"
      >
        ＋ 手写一条本章批注
      </button>
    );
  }
  const save = () => {
    if (!text.trim()) return;
    void useReaderStore.getState().addManualAnnotation(null, text);
    setText("");
    setOpen(false);
  };
  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <p className="mb-1.5 text-[11px] text-ink-faint">本章批注（想锚定在某段文字上？在正文选中后点「批注」）</p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="写下你的想法…（Ctrl+Enter 保存）"
        rows={3}
        className="w-full resize-y rounded-lg border border-line bg-paper p-2 text-sm text-ink outline-none focus:border-accent"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs text-ink-faint hover:text-ink">
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
  );
}

/** 批注就地编辑器：改动落应用内 JSON（准绳），并单向同步进 Obsidian */
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
        <span className="text-[11px] text-ink-faint">改动会同步到 Obsidian（Ctrl+Enter 保存）</span>
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

function NoteCard({ anno, streamText }: { anno: Annotation; streamText?: string }) {
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

function PassageCard({ anno, streamText }: { anno: Annotation; streamText?: string }) {
  const focus = useReaderStore((s) => s.focus);
  const ref = useRef<HTMLDivElement>(null);
  const isStreaming = streamText != null;
  const focused = focus?.id === anno.id;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (focused && focus?.source === "text") {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, focus?.nonce]);

  return (
    <div
      ref={ref}
      onClick={() => !editing && useReaderStore.getState().setFocus(anno.id, "panel")}
      className={`mb-2.5 rounded-xl border p-3.5 transition-colors ${editing ? "cursor-default" : "cursor-pointer"} ${
        focused ? "border-accent bg-accent-soft/40" : "border-line hover:border-ink-faint"
      }`}
    >
      {anno.source === "user" && (
        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-accent">✎ 我的批注</p>
      )}
      {anno.anchor && (
        <p className="mb-2 border-l-2 border-accent pl-2 text-xs leading-relaxed text-ink-soft">
          {truncate(anno.anchor.quote.replace(/\s+/g, " "), 60)}
        </p>
      )}
      {editing ? (
        <AnnoEditor anno={anno} onDone={() => setEditing(false)} />
      ) : (
        <Markdown text={isStreaming ? streamText : anno.content} streaming={isStreaming} />
      )}
      {!isStreaming && !editing && (
        <div className="mt-2 flex justify-end gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="text-xs text-ink-faint hover:text-ink"
            title="编辑批注（改动单向同步到 Obsidian）"
          >
            编辑
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirm("删除这条注释？（markdown 中已写入的记录会保留）")) {
                void useReaderStore.getState().removeAnnotation(anno.id);
              }
            }}
            className="text-xs text-ink-faint hover:text-red-500"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}
