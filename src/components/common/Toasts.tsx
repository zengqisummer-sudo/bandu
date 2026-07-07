import { useUiStore } from "../../stores/uiStore";

const STYLES = {
  info: "border-line bg-card text-ink",
  success: "border-line bg-card text-ink",
  error: "border-red-300 bg-card text-red-700 dark:border-red-900 dark:text-red-400",
};

const ICONS = { info: "ℹ", success: "✓", error: "⚠" };

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-left text-sm shadow-lg ${STYLES[t.kind]}`}
        >
          <span className="mr-2 text-accent">{ICONS[t.kind]}</span>
          {t.text}
        </button>
      ))}
    </div>
  );
}
