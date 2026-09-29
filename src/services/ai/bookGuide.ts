import type { BookMeta, Settings } from "../../types/models";

/** Only bibliographic metadata leaves the browser; no epub text is sent. */
export async function fetchBookGuide(book: BookMeta, settings: Settings, signal?: AbortSignal): Promise<string> {
  const cfg = settings.bookSearch;
  const key = localStorage.getItem("aireader.key.bookSearch");
  if (!cfg?.baseUrl || !cfg.model || !key) throw new Error("请在设置的「全书导读 · 联网模型」中填写地址、模型和 API key");
  const input = `请实际搜索网络资料，为《${book.title}》（作者：${book.author || "待核实"}）撰写中文全书导读：全书写作脉络、作者背景、写书背景。核对书名作者，无法确认时说明，不要编造。不要预告小说后段情节。引用可靠资料并提供来源链接。`;
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const anthropic = cfg.protocol === "anthropic";
  const res = await fetch(anthropic ? `${base.replace(/\/v1$/, "")}/v1/messages` : `${base}/responses`, {
    method: "POST", signal,
    headers: anthropic ? { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(anthropic ? {
      model: cfg.model, max_tokens: 4096, messages: [{ role: "user", content: input }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    } : { model: cfg.model, input, tools: [{ type: "web_search" }], tool_choice: "required", max_output_tokens: 4096 }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `联网导读请求失败（${res.status}）`);
  type Block = { type: string; name?: string; status?: string; text?: string; url?: string; title?: string; annotations?: Block[]; citations?: Block[]; content?: Block[] };
  const blocks: Block[] = anthropic ? data.content ?? [] : data.output ?? [];
  const searched = anthropic
    ? blocks.some(b => b.type === "web_search_tool_result" && Array.isArray(b.content) && b.content.some(x => x.type === "web_search_result"))
    : blocks.some(b => b.type === "web_search_call" && b.status === "completed");
  if (!searched) throw new Error("模型没有完成联网搜索，请检查模型与接口的搜索支持；未保存为导读。");
  if ((!anthropic && data.status !== "completed") || (anthropic && data.stop_reason !== "end_turn")) throw new Error("联网导读尚未完整生成，请重试或调整模型输出额度。");
  const parts = anthropic ? blocks.filter(b => b.type === "text") : blocks.flatMap(b => b.content ?? []).filter(b => b.type === "output_text");
  const sources = parts.flatMap(p => p.annotations ?? p.citations ?? []).filter(c => c.url && /^https?:\/\//.test(c.url));
  const urls = [...new Map(sources.map(c => [c.url!, c])).values()];
  const text = parts.map(p => p.text ?? "").join("\n\n").trim();
  if (!text || !urls.length) throw new Error("联网结果缺少正文或可核验来源，未保存；请重试。");
  return text + "\n\n### 资料来源\n" + urls.map(c => `- [${(c.title || c.url!).replace(/[\[\]\n]/g, " ")}](<${c.url!.replace(/[<>\s]/g, encodeURIComponent)}>)`).join("\n");
}
