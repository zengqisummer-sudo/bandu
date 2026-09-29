import { applyPendingNavigation } from "../stores/readingNavigation";
import { useFootnoteStore } from "../stores/footnoteStore";
import { useEffect, useState } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { useReaderStore } from "../stores/readerStore";
import { useChatStore } from "../stores/chatStore";
import { useUiStore } from "../stores/uiStore";
import { ReaderHeader } from "../components/reader/ReaderHeader";
import { TocSidebar } from "../components/reader/TocSidebar";
import { ChapterView } from "../components/reader/ChapterView";
import { SidePanel } from "../components/panel/SidePanel";
import { RestoreAccess } from "../components/shelf/RestoreAccess";
import { navigate } from "../lib/router";

export function ReaderPage({ bookId }: { bookId: string }) {
  const bootState = useSettingsStore((s) => s.bootState);
  const book = useReaderStore((s) => s.book);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    if (bootState === "wizard") navigate("/");
  }, [bootState]);

  useEffect(() => {
    if (bootState !== "ready") return;
    let cancelled = false;
    void (async () => {
      const ok = await useReaderStore.getState().openBook(bookId);
      if (cancelled) return;
      if (!ok) {
        navigate("/");
        return;
      }
      await Promise.all([useChatStore.getState().load(bookId), useFootnoteStore.getState().load(useReaderStore.getState().book!)]);
      if (!cancelled) await applyPendingNavigation(bookId);
    })();
    return () => {
      cancelled = true;
      useReaderStore.getState().closeBook();
      useChatStore.getState().reset();
      useFootnoteStore.getState().reset();
    };
  }, [bookId, bootState]);

  if (bootState === "fs-restore") return <RestoreAccess />;
  if (bootState !== "ready" || !book) {
    return <div className="flex h-full items-center justify-center text-ink-faint">打开书籍…</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <ReaderHeader tocOpen={tocOpen} onToggleToc={() => setTocOpen((v) => !v)} />
      <div className="flex min-h-0 flex-1">
        {tocOpen && <TocSidebar onNavigate={() => setTocOpen(false)} />}
        <ChapterView />
        {panelOpen && <SidePanel />}
      </div>
    </div>
  );
}
