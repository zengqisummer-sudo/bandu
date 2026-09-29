import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { normalizeTopic, suggestTopics } from "../../lib/topics";

/**
 * 话题输入：chips + 联想下拉（独立话题词库）。
 * 交互：Enter/空格/逗号 提交当前输入；↑↓ 选联想项，Enter/Tab 采纳；
 * 空输入时 Backspace 删最后一个 chip；Esc 收起下拉。
 */
export interface TopicInputHandle {
  /** Include any still-typed topic when the enclosing editor saves. */
  commit(): string[];
}

export const TopicInput = forwardRef<TopicInputHandle, {
  value: string[];
  onChange: (topics: string[]) => void;
  availableTopics: string[];
  autoFocus?: boolean;
  placeholder?: string;
}>(function TopicInput({
  value,
  onChange,
  availableTopics,
  autoFocus,
  placeholder,
}, ref) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // 未主动选联想项时，回车添加原样输入
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const composing = useRef(false);
  valueRef.current = value;

  const suggestions = useMemo(() => suggestTopics(text, availableTopics, value), [text, availableTopics, value]);

  useEffect(() => {
    setHi(-1);
  }, [text]);

  // 外部点击关闭候选列表；输入框失焦负责提交已输入的话题。
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const add = (raw: string) => {
    const t = normalizeTopic(raw);
    if (!t) return valueRef.current;
    const next = valueRef.current.includes(t) ? valueRef.current : [...valueRef.current, t];
    if (next !== valueRef.current) {
      valueRef.current = next;
      onChange(next);
    }
    if (inputRef.current) inputRef.current.value = "";
    setText("");
    setHi(-1);
    setOpen(false);
    return next;
  };

  useImperativeHandle(ref, () => ({ commit: () => add(inputRef.current?.value ?? text) }));

  const remove = (t: string) => {
    const next = valueRef.current.filter(x => x !== t);
    valueRef.current = next;
    onChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => h <= 0 ? suggestions.length - 1 : h - 1);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (open && hi >= 0 && suggestions[hi]) {
        if (e.key === "Enter") e.preventDefault();
        add(suggestions[hi]);
      } else if (text) {
        if (e.key === "Enter") e.preventDefault();
        add(text);
      }
    } else if (e.key === " " || e.key === "," || e.key === "，" || e.key === "、") {
      e.preventDefault();
      if (text) add(text);
    } else if (e.key === "Backspace" && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-paper px-2 py-1.5 focus-within:border-accent"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
          >
            {t}
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => remove(t)}
              className="text-accent/60 hover:text-accent"
              aria-label={`移除话题 ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          aria-label="话题"
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={e => {
            if (!composing.current) add(e.currentTarget.value);
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={e => {
            composing.current = false;
            if (document.activeElement !== e.currentTarget) add(e.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "" : (placeholder ?? "输入话题，Enter 确认")}
          className="min-w-[8em] flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-ink-faint"
        />
        {normalizeTopic(text) && <button
          type="button"
          aria-label="添加话题"
          onMouseDown={e => e.preventDefault()}
          onClick={() => { if (!composing.current) add(inputRef.current?.value ?? text); inputRef.current?.focus(); }}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-accent hover:bg-accent-soft"
        >添加</button>}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // 防止 input 失焦
              }}
              onClick={() => add(s)}
              onMouseEnter={() => setHi(i)}
              className={`block w-full px-3 py-1.5 text-left text-xs ${
                i === hi ? "bg-accent-soft text-ink" : "text-ink-soft"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
