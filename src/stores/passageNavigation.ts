import { create } from "zustand";
import type { Anchor } from "../types/models";
import { useReaderStore } from "./readerStore";

export const usePassageNavigation = create<{ target: { bookId: string; spine: number; anchor: Anchor; nonce: number; focusNonce?: number } | null }>(() => ({ target: null }));
let request = 0;
export async function jumpToPassage(spine: number, anchor: Anchor | null, id?: string) {
  const token = ++request;
  const reader = useReaderStore.getState();
  const bookId = reader.bookId;
  if (!bookId || spine < 0) return;
  usePassageNavigation.setState({ target: null });
  await reader.jumpTo(spine, anchor?.para ?? 0);
  if (token !== request || useReaderStore.getState().bookId !== bookId) return;
  if (id) reader.setFocus(id, "panel");
  else useReaderStore.setState({ focus: null });
  if (anchor) usePassageNavigation.setState({ target: { bookId, spine, anchor, nonce: token, focusNonce: useReaderStore.getState().focus?.nonce } });
}
