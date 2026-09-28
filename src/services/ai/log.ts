import { storage, storageReady } from "../storage";
import { paths } from "../storage/paths";
import { useSettingsStore } from "../../stores/settingsStore";
import type { ChatMessage } from "./client";

// 调试用 AI 请求日志（设置里"是否打印请求AI的日志"开启后生效）。
// 每本书一份 markdown，落在运行状态文件夹（books/{id}/ai-请求日志.md），只追加。
// 记录每次请求大模型的完整 prompt（system + messages）与模型返回，便于调 prompt / 排查解析失败。

export interface AiLogEntry {
  bookId: string;
  /** 场景：章节导读 / 段落深挖 / 随文注释 / 对话 */
  scene: string;
  spine?: number;
  provider: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  /** 模型返回的原始文本（失败时为已流出的部分，可能为空） */
  output: string;
  /** 处理结果：成功 / 解析失败：… / 请求失败：… 等 */
  status: string;
}

const FRONTMATTER = [
  "---",
  "类型: AI 请求日志",
  "说明: 调试用，记录每次请求大模型的 prompt 与返回；仅在设置开启时写入",
  "---",
].join("\n");

/** 用足够长的反引号围栏包裹任意文本，避免内容里的 ``` 提前闭合 */
function fence(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}text\n${text}\n${ticks}`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function buildBlock(entry: AiLogEntry): string {
  const spinePart = entry.spine != null ? ` · spine ${entry.spine}` : "";
  const parts: string[] = [
    "---",
    "",
    `## ${stamp()} · ${entry.scene}${spinePart}`,
    "",
    `- 模型：${entry.provider} / ${entry.model}`,
    `- 结果：${entry.status}`,
    "",
    "### System Prompt",
    "",
    fence(entry.system || "（空）"),
    "",
    "### 输入消息",
    "",
  ];
  if (entry.messages.length === 0) {
    parts.push("（无）", "");
  } else {
    for (const m of entry.messages) {
      parts.push(`**${m.role}：**`, "", fence(m.content), "");
    }
  }
  parts.push("### 模型返回", "", fence(entry.output || "（空）"));
  return parts.join("\n");
}

/**
 * 记录一次 AI 往返。开关关闭时直接 no-op；写盘失败只告警，绝不影响正常生成流程。
 */
export async function logAiExchange(entry: AiLogEntry): Promise<void> {
  try {
    if (!useSettingsStore.getState().settings.logAiRequests) return;
    if (!storageReady()) return;
    await storage().appendStateMarkdown(paths.aiLog(entry.bookId), buildBlock(entry), FRONTMATTER);
  } catch (e) {
    console.warn("AI 请求日志写入失败（不影响生成）", e);
  }
}
