// note_type 的展示映射（ANNOTATION_SPEC §3）。类型可扩展：未知类型按 direction 样式渲染。

export const NOTE_TYPE_LABELS: Record<string, string> = {
  direction: "导向",
  reference: "指涉",
  perspective: "视角",
  background: "背景",
};

export function noteTypeLabel(noteType: string): string {
  return NOTE_TYPE_LABELS[noteType] ?? noteType;
}

/** CSS 类名后缀：未知类型落到 direction 默认样式 */
export function noteTypeClass(noteType: string): string {
  return noteType in NOTE_TYPE_LABELS ? noteType : "direction";
}

/** Obsidian callout 类型映射（存档形态用） */
export function calloutTag(noteType: string): string {
  switch (noteType) {
    case "background":
    case "reference":
      return "info";
    case "perspective":
      return "quote";
    default:
      return "note";
  }
}
