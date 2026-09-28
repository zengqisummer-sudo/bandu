import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTag, sanitizeTagTyping, suggestTags } from "../../lib/tags";

/**
 * 标签输入：chips + 联想下拉（复用历史标签）。
 * 交互：Enter/空格/逗号 提交当前输入；↑↓ 选联想项，Enter/Tab 采纳；
 * 空输入时 Backspace 删最后一个 chip；Esc 收起下拉。
 */
export function TagInput({
  value,
  onChange,
  bookTags,
  autoFocus,
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  /** 本书已用过的标签（联想候选的一部分） */
  bookTags: string[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // 下拉高亮序号
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => suggestTags(text, bookTags, value), [text, bookTags, value]);

  useEffect(() => {
    setHi(0);
  }, [text]);

  // 点击组件外部收起下拉（不提交半截输入，避免误打标）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const add = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t) return false;
    if (!value.includes(t)) onChange([...value, t]);
    setText("");
    return true;
  };

  const remove = (t: string) => onChange(value.filter((x) => x !== t));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHi((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (open && suggestions[hi] && (e.key === "Tab" || text)) {
        e.preventDefault();
        add(suggestions[hi]);
      } else if (text) {
        e.preventDefault();
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
            #{t}
            <button
              onClick={() => remove(t)}
              className="text-accent/60 hover:text-accent"
              aria-label={`移除标签 ${t}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(sanitizeTagTyping(e.target.value));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "" : (placeholder ?? "输入标签，Enter 确认，/ 分层")}
          className="min-w-[8em] flex-1 bg-transparent py-0.5 text-xs outline-none placeholder:text-ink-faint"
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-card shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s}
              onMouseDown={(e) => {
                e.preventDefault(); // 防止 input 失焦
                add(s);
              }}
              onMouseEnter={() => setHi(i)}
              className={`block w-full px-3 py-1.5 text-left text-xs ${
                i === hi ? "bg-accent-soft text-ink" : "text-ink-soft"
              }`}
            >
              #{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
