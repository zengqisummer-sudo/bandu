import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useReaderStore } from "../../stores/readerStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { chapterLabelFor } from "../../services/ai/context";
import { navigate } from "../../lib/router";

export function ReaderHeader({ tocOpen, onToggleToc }: { tocOpen: boolean; onToggleToc: () => void }) {
  const book = useReaderStore((s) => s.book);
  const progress = useReaderStore((s) => s.progress);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const setPanel = useUiStore((s) => s.setPanel);
  const openSettings = useUiStore((s) => s.openSettings);

  if (!book) return null;
  const label = chapterLabelFor(book, progress.spine);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-card px-3">
      <button
        onClick={() => navigate("/")}
        className="rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-accent-soft hover:text-ink"
      >
        ← 书架
      </button>
      <div className="min-w-0 flex-1 text-center">
        <span className="truncate text-sm font-medium">{book.title}</span>
        <span className="mx-2 text-ink-faint">·</span>
        <span className="truncate text-sm text-ink-soft">{label}</span>
      </div>
      <span className="text-xs tabular-nums text-ink-faint">{Math.round(progress.percent * 100)}%</span>
      <HeaderBtn active={tocOpen} onClick={onToggleToc} title="目录">
        目录
      </HeaderBtn>
      <PrefsButton />
      <HeaderBtn active={panelOpen} onClick={() => setPanel(!panelOpen)} title="注释与对话面板">
        面板
      </HeaderBtn>
      <HeaderBtn onClick={openSettings} title="设置">
        ⚙
      </HeaderBtn>
    </header>
  );
}

function HeaderBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md px-2 py-1 text-sm transition-colors ${
        active ? "bg-accent-soft text-ink" : "text-ink-soft hover:bg-accent-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PrefsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reading = useSettingsStore((s) => s.settings.reading);
  const saveSettings = useSettingsStore((s) => s.saveSettings);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const patch = (p: Partial<typeof reading>) => void saveSettings({ reading: { ...reading, ...p } });

  return (
    <div className="relative" ref={ref}>
      <HeaderBtn onClick={() => setOpen((v) => !v)} active={open} title="阅读偏好">
        Aa
      </HeaderBtn>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-60 rounded-xl border border-line bg-card p-4 shadow-xl">
          <PrefRow
            label="字号"
            value={`${reading.fontSize}px`}
            onDec={() => patch({ fontSize: Math.max(14, reading.fontSize - 1) })}
            onInc={() => patch({ fontSize: Math.min(26, reading.fontSize + 1) })}
          />
          <PrefRow
            label="行距"
            value={reading.lineHeight.toFixed(2)}
            onDec={() => patch({ lineHeight: Math.max(1.5, +(reading.lineHeight - 0.1).toFixed(2)) })}
            onInc={() => patch({ lineHeight: Math.min(2.6, +(reading.lineHeight + 0.1).toFixed(2)) })}
          />
          <PrefRow
            label="页宽"
            value={`${reading.maxWidth}px`}
            onDec={() => patch({ maxWidth: Math.max(560, reading.maxWidth - 40) })}
            onInc={() => patch({ maxWidth: Math.min(1000, reading.maxWidth + 40) })}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-ink-soft" title="长段按句拆行，分割线标示原书分段；不改动书的内容">
              友好排版
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => patch({ friendly: true })}
                className={`rounded-md border px-2.5 py-1 text-xs ${reading.friendly ? "border-accent bg-accent-soft" : "border-line"}`}
              >
                开
              </button>
              <button
                onClick={() => patch({ friendly: false })}
                className={`rounded-md border px-2.5 py-1 text-xs ${!reading.friendly ? "border-accent bg-accent-soft" : "border-line"}`}
              >
                关
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-ink-soft">主题</span>
            <div className="flex gap-1">
              <button
                onClick={() => patch({ theme: "light" })}
                className={`rounded-md border px-2.5 py-1 text-xs ${reading.theme === "light" ? "border-accent bg-accent-soft" : "border-line"}`}
              >
                亮
              </button>
              <button
                onClick={() => patch({ theme: "dark" })}
                className={`rounded-md border px-2.5 py-1 text-xs ${reading.theme === "dark" ? "border-accent bg-accent-soft" : "border-line"}`}
              >
                暗
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PrefRow({
  label,
  value,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        <button onClick={onDec} className="h-6 w-6 rounded-md border border-line text-sm leading-none hover:bg-accent-soft">
          −
        </button>
        <span className="w-12 text-center text-xs tabular-nums">{value}</span>
        <button onClick={onInc} className="h-6 w-6 rounded-md border border-line text-sm leading-none hover:bg-accent-soft">
          ＋
        </button>
      </div>
    </div>
  );
}
