import { useUiStore, type PanelTab } from "../../stores/uiStore";
import { useReaderStore } from "../../stores/readerStore";
import { useChatStore } from "../../stores/chatStore";
import { AnnotationsTab } from "./AnnotationsTab";
import { ChatTab } from "./ChatTab";
import { ExcerptsTab } from "./ExcerptsTab";

const TABS: { id: PanelTab; label: string }[] = [
  { id: "annos", label: "注释" },
  { id: "chat", label: "对话" },
  { id: "excerpts", label: "摘录" },
];

export function SidePanel() {
  const tab = useUiStore((s) => s.panelTab);
  const setPanel = useUiStore((s) => s.setPanel);
  const chapter = useReaderStore((s) => s.chapter);
  const annotations = useReaderStore((s) => s.annotations);
  const excerpts = useReaderStore((s) => s.excerpts);
  const sessions = useChatStore((s) => s.sessions);

  const counts: Record<PanelTab, number> = {
    annos: annotations.filter((a) => a.spine === chapter?.spine).length,
    chat: sessions.length,
    excerpts: excerpts.length,
  };

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-card">
      <div className="flex shrink-0 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setPanel(true, t.id)}
            className={`flex-1 border-b-2 px-2 py-2.5 text-sm transition-colors ${
              tab === t.id
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
            {counts[t.id] > 0 && <span className="ml-1 text-xs text-ink-faint">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "annos" && <AnnotationsTab />}
        {tab === "chat" && <ChatTab />}
        {tab === "excerpts" && <ExcerptsTab />}
      </div>
    </aside>
  );
}
