import { useState } from "react";
import type { ContentType } from "../../types/models";
import { Modal } from "../common/Modal";

const OPTIONS: { type: ContentType; label: string; desc: string }[] = [
  { type: "novel", label: "小说", desc: "叙事视角、人物指涉、段落功能" },
  { type: "poetry", label: "诗歌", desc: "创作背景、格律、意象系统" },
  { type: "social", label: "社科", desc: "概念解释、论证脉络、讨论" },
];

export function ContentTypeDialog({
  file,
  importing,
  onCancel,
  onConfirm,
}: {
  file: File | null;
  importing: boolean;
  onCancel: () => void;
  onConfirm: (type: ContentType) => void;
}) {
  const [type, setType] = useState<ContentType>("novel");
  return (
    <Modal open={!!file} onClose={importing ? () => {} : onCancel} title="导入书籍">
      <p className="mb-3 truncate text-sm text-ink-soft">{file?.name}</p>
      <p className="mb-2 text-xs text-ink-faint">选择内容类型（决定 AI 注释与对话的侧重，之后可在设置中调整 prompt）：</p>
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.type}
            onClick={() => setType(o.type)}
            className={`rounded-lg border px-4 py-3 text-left transition-colors ${
              type === o.type ? "border-accent bg-accent-soft" : "border-line hover:border-ink-faint"
            }`}
          >
            <div className="text-sm font-medium">{o.label}</div>
            <div className="mt-0.5 text-xs text-ink-faint">{o.desc}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={importing}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:bg-accent-soft"
        >
          取消
        </button>
        <button
          onClick={() => onConfirm(type)}
          disabled={importing}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
        >
          {importing ? "解析中…" : "导入"}
        </button>
      </div>
    </Modal>
  );
}
