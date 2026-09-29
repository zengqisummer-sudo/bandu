import { create } from "zustand";
import type { Progress } from "../types/models";
import { useReaderStore } from "./readerStore";
import { useChatStore } from "./chatStore";
import { useUiStore } from "./uiStore";
import { navigate } from "../lib/router";

type Target = { bookId: string; spine: number; para: number; id?: string };
export const useReadingNavigation = create<{ pending: Target | null; origin: { bookId: string; progress: Progress } | null }>(() => ({ pending: null, origin: null }));
export async function jumpToIdea(target: Target) {
  const reader = useReaderStore.getState();
  if (reader.bookId !== target.bookId) {
    const origin = useReadingNavigation.getState().origin ?? (reader.bookId ? { bookId: reader.bookId, progress: reader.returnPoint ?? reader.progress } : null);
    useReadingNavigation.setState({ pending: target, origin });
    navigate(`/read/${encodeURIComponent(target.bookId)}`);
  } else {
    await reader.jumpTo(target.spine, target.para);
    if (target.id) reader.setFocus(target.id, "panel");
  }
}
export async function applyPendingNavigation(bookId: string) {
  const { pending } = useReadingNavigation.getState();
  if (pending?.bookId !== bookId) return;
  useReadingNavigation.setState({ pending: null });
  await useReaderStore.getState().jumpTo(pending.spine, pending.para);
  if (pending.id) {
    useChatStore.getState().select(pending.id);
    useUiStore.getState().setPanel(true, "chat");
    useReaderStore.getState().setFocus(pending.id, "text");
  } else {
    useReaderStore.setState({ returnPoint: null, focus: null });
  }
}
export async function returnToReading() {
  const { origin } = useReadingNavigation.getState();
  if (origin) {
    useReadingNavigation.setState({ origin: null, pending: { bookId: origin.bookId, spine: origin.progress.spine, para: origin.progress.anchor.para } });
    if (useReaderStore.getState().bookId === origin.bookId) await applyPendingNavigation(origin.bookId);
    else navigate(`/read/${encodeURIComponent(origin.bookId)}`);
  } else await useReaderStore.getState().returnToReading();
}
