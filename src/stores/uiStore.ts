import { create } from "zustand";
import { genId } from "../lib/utils";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  text: string;
}

export type PanelTab = "annos" | "chat" | "excerpts";

interface UiState {
  toasts: Toast[];
  settingsOpen: boolean;
  panelOpen: boolean;
  panelTab: PanelTab;
  toast(kind: Toast["kind"], text: string): void;
  dismissToast(id: string): void;
  openSettings(): void;
  closeSettings(): void;
  setPanel(open: boolean, tab?: PanelTab): void;
}

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  settingsOpen: false,
  panelOpen: true,
  panelTab: "annos",
  toast(kind, text) {
    const id = genId("t");
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 6000 : 3500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setPanel: (open, tab) => set((s) => ({ panelOpen: open, panelTab: tab ?? s.panelTab })),
}));

export const toast = (kind: Toast["kind"], text: string) => useUiStore.getState().toast(kind, text);
