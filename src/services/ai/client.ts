import type { ProviderId, Settings } from "../../types/models";

// 多提供商流式 client（SPEC §4.1）。
// OpenAI 兼容协议（DeepSeek / 自定义端点）与 Anthropic 原生协议两种实现。

export interface AiConfig {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  key: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class AiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

const KEY_PREFIX = "aireader.key.";

export function getApiKey(provider: ProviderId): string {
  return localStorage.getItem(KEY_PREFIX + provider) ?? "";
}

export function setApiKey(provider: ProviderId, key: string) {
  if (key) localStorage.setItem(KEY_PREFIX + provider, key);
  else localStorage.removeItem(KEY_PREFIX + provider);
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  custom: "自定义（OpenAI 兼容）",
};

export const MODEL_PRESETS: Record<ProviderId, string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
  anthropic: ["claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
  custom: [],
};

export function resolveAiConfig(settings: Settings): AiConfig | null {
  const p = settings.ai.provider;
  const key = getApiKey(p);
  if (!key) return null;
  if (p === "deepseek") {
    return { provider: p, baseUrl: "https://api.deepseek.com", model: settings.ai.deepseek.model, key };
  }
  if (p === "anthropic") {
    return { provider: p, baseUrl: "https://api.anthropic.com", model: settings.ai.anthropic.model, key };
  }
  const { baseUrl, model } = settings.ai.custom;
  if (!baseUrl || !model) return null;
  return { provider: p, baseUrl, model, key };
}

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) yield line;
    }
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}

async function toAiError(res: Response): Promise<AiError> {
  let msg = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    msg = body?.error?.message ?? body?.message ?? msg;
  } catch {
    /* 非 JSON 响应 */
  }
  return new AiError(res.status, msg);
}

export function friendlyAiError(e: unknown): string {
  if (e instanceof AiError) {
    if (e.status === 401 || e.status === 403) return `API key 无效或未授权（${e.message}）`;
    if ((e.status === 400 || e.status === 404) && /model/i.test(e.message))
      return `模型 ID 可能不正确，请在设置中核对（${e.message}）`;
    if (e.status === 429) return "请求频率或额度受限，请稍后重试";
    if (e.status >= 500) return `服务端暂时不可用（${e.status}），请稍后重试`;
    return e.message;
  }
  if (e instanceof DOMException && e.name === "AbortError") return "已取消";
  if (e instanceof TypeError) return "网络请求失败：可能是断网，或该服务不允许浏览器直连（CORS）";
  return e instanceof Error ? e.message : String(e);
}

interface StreamOpts {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  signal?: AbortSignal;
}

async function* streamOpenAiCompatible(cfg: AiConfig, opts: StreamOpts): AsyncGenerator<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
      stream: true,
      max_tokens: opts.maxTokens,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw await toAiError(res);
  for await (const line of sseLines(res)) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const data = l.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const j = JSON.parse(data);
      const delta = j.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) yield delta;
    } catch {
      /* 忽略无法解析的行 */
    }
  }
}

async function* streamAnthropic(cfg: AiConfig, opts: StreamOpts): AsyncGenerator<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: cfg.model,
      system: opts.system,
      messages: opts.messages,
      stream: true,
      max_tokens: opts.maxTokens,
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw await toAiError(res);
  for await (const line of sseLines(res)) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    try {
      const j = JSON.parse(l.slice(5).trim());
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta") yield j.delta.text as string;
      if (j.type === "error") throw new AiError(500, j.error?.message ?? "流式响应错误");
    } catch (e) {
      if (e instanceof AiError) throw e;
      /* 忽略无法解析的行 */
    }
  }
}

export function streamChat(cfg: AiConfig, opts: StreamOpts): AsyncGenerator<string> {
  return cfg.provider === "anthropic" ? streamAnthropic(cfg, opts) : streamOpenAiCompatible(cfg, opts);
}

export async function testConnection(cfg: AiConfig): Promise<{ ok: boolean; message: string }> {
  try {
    let out = "";
    for await (const chunk of streamChat(cfg, {
      system: "你是连通性测试助手。",
      messages: [{ role: "user", content: "回复两个字：正常" }],
      maxTokens: 16,
    })) {
      out += chunk;
      if (out.length > 8) break;
    }
    return { ok: true, message: `连接成功：${out.trim().slice(0, 20) || "有响应"}` };
  } catch (e) {
    return { ok: false, message: friendlyAiError(e) };
  }
}
