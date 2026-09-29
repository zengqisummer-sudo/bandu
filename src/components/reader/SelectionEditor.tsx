import { useEffect, useRef, useState } from "react";
import type { Anchor, Footnote } from "../../types/models";
import { useFootnoteStore, newFootnote, explainFootnote } from "../../stores/footnoteStore";
import { useReaderStore } from "../../stores/readerStore";
import { useUiStore, toast } from "../../stores/uiStore";
import { friendlyAiError } from "../../services/ai/client";
import { TopicInput, type TopicInputHandle } from "../common/TopicInput";

export function SelectionEditor({ anchor, mode, x, y, onClose }: { anchor: Anchor; mode: "footnote" | "idea"; x: number; y: number; onClose(): void }) {
  const [text, setText] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [sync, setSync] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note] = useState<Footnote>(() => newFootnote(anchor));
  const abort = useRef<AbortController>();
  const topicInputRef = useRef<TopicInputHandle>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const save = async () => {
    if (!text.trim() || busy || saving) return;
    setSaving(true);
    try {
      if (mode === "footnote") {
        if (!await useFootnoteStore.getState().save({ ...note, text: text.trim(), sync })) return;
        useUiStore.getState().setPanel(true, "annos");
        useReaderStore.getState().setFocus(note.id, "text");
      } else {
        const savedTopics = topicInputRef.current?.commit() ?? topics;
        await useReaderStore.getState().addManualAnnotation(anchor, text, savedTopics);
        useUiStore.getState().setPanel(true, "chat");
      }
      onClose();
    } catch (e) { toast("error", friendlyAiError(e)); }
    finally { setSaving(false); }
  };
  const ask = async () => {
    if (busy) return; const ctrl = new AbortController(); abort.current = ctrl; setBusy(true);
    try { const reply = await explainFootnote(anchor, ctrl.signal); if (!ctrl.signal.aborted) setText(reply); }
    catch (e) { if (!ctrl.signal.aborted) toast("error", friendlyAiError(e)); }
    finally { setBusy(false); }
  };
  return <div className="fixed z-40 max-h-[80vh] overflow-auto -translate-x-1/2 rounded-xl border border-line bg-card p-3 shadow-xl" style={{ width: 340, left: Math.min(Math.max(182, x), window.innerWidth - 182), top: Math.max(8, Math.min(y + 10, window.innerHeight - 340)) }} onMouseDown={e => e.stopPropagation()}>
    <p className="mb-2 border-l-2 border-accent pl-2 text-xs text-ink-soft">{anchor.quote.slice(0, 100)}</p>
    {mode === "idea" && <TopicInput ref={topicInputRef} value={topics} onChange={setTopics} availableTopics={[]} placeholder="关联话题（可选，可输入多个）" />}
    <div className="relative mt-2"><textarea autoFocus disabled={busy || saving} value={text} onChange={e => setText(e.target.value)} rows={5} placeholder={mode === "footnote" ? "写下脚注式解释…" : "写下你的想法…"} className="w-full resize-y rounded-lg border border-line bg-paper p-2 pb-9 text-sm outline-none focus:border-accent" onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } if (e.key === "Escape") onClose(); }} />
      {mode === "footnote" && <button disabled={busy || saving} onClick={() => void ask()} title="问AI：生成脚注解释，填入输入框" aria-label="问AI生成注释" className="absolute bottom-3 right-2 rounded-lg px-2 py-1 text-accent hover:bg-accent-soft disabled:opacity-40">{busy ? "生成中…" : "✦"}</button>}
    </div>
    {mode === "footnote" && <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} />同步全文（保留已有独立注释）</label>}
    <div className="mt-2 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-ink-faint">取消</button><button onClick={() => void save()} disabled={!text.trim() || busy || saving} className="rounded-lg bg-accent px-3 py-1.5 text-xs text-paper disabled:opacity-30">{saving ? "保存中…" : "保存"}</button></div>
  </div>;
}
