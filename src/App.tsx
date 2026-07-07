import { useEffect } from "react";
import { useRoute } from "./lib/router";
import { useSettingsStore } from "./stores/settingsStore";
import { ShelfPage } from "./pages/ShelfPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SettingsModal } from "./components/settings/SettingsModal";
import { Toasts } from "./components/common/Toasts";

export default function App() {
  const bootState = useSettingsStore((s) => s.bootState);
  const init = useSettingsStore((s) => s.init);
  const route = useRoute();

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full">
      {bootState === "booting" ? (
        <div className="flex h-full items-center justify-center text-ink-faint">载入中…</div>
      ) : route.name === "shelf" ? (
        <ShelfPage />
      ) : (
        <ReaderPage bookId={route.bookId} />
      )}
      <SettingsModal />
      <Toasts />
    </div>
  );
}
