import { useState } from "react";
import type { ProviderId } from "../../types/models";
import { useSettingsStore } from "../../stores/settingsStore";
import { fsaSupported, pickDirectory } from "../../services/storage/handles";
import { MODEL_PRESETS, PROVIDER_LABELS, setApiKey } from "../../services/ai/client";

export function FirstRunWizard() {
  const { adoptFolders, chooseIdbMode, saveSettings } = useSettingsStore();
  const [step, setStep] = useState<"mode" | "folders" | "ai">("mode");
  const [mode, setMode] = useState<"fs" | "idb">("fs");
  const [stateDir, setStateDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [productDir, setProductDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [provider, setProvider] = useState<ProviderId>("deepseek");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const supported = fsaSupported();

  const finish = async () => {
    setBusy(true);
    try {
      if (mode === "fs" && stateDir && productDir) await adoptFolders(stateDir, productDir);
      else await chooseIdbMode();
      if (key.trim()) setApiKey(provider, key.trim());
      const s = useSettingsStore.getState().settings;
      await saveSettings({
        ai: {
          ...s.ai,
          provider,
          ...(provider === "deepseek" ? { deepseek: { model: model.trim() || "deepseek-v4-flash" } } : {}),
          ...(provider === "anthropic" ? { anthropic: { model: model.trim() || "claude-sonnet-5" } } : {}),
          ...(provider === "custom" ? { custom: { baseUrl: baseUrl.trim(), model: model.trim() } } : {}),
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-card p-8 shadow-sm">
        <h1 className="font-reading text-xl font-semibold">欢迎使用「伴读」</h1>
        <p className="mt-1 text-sm text-ink-soft">帮你读懂难读的书：随文注释 + 随时对话。先做两步设置。</p>

        {step === "mode" && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium text-ink-faint">① 数据存在哪里？</p>
            <button
              onClick={() => supported && setMode("fs")}
              disabled={!supported}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                mode === "fs" && supported ? "border-accent bg-accent-soft" : "border-line"
              } ${supported ? "" : "opacity-50"}`}
            >
              <div className="text-sm font-medium">
                文件夹模式 <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-paper">推荐</span>
              </div>
              <div className="mt-1 text-xs text-ink-faint">
                注释/对话/摘录写成 Obsidian 可索引的 markdown 文件；换浏览器、清缓存都不丢数据。
                {!supported && "（当前浏览器不支持，请用 Chrome / Edge）"}
              </div>
            </button>
            <button
              onClick={() => setMode("idb")}
              className={`mt-2 w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                mode === "idb" ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <div className="text-sm font-medium">浏览器模式</div>
              <div className="mt-1 text-xs text-ink-faint">零设置即用，数据存在浏览器里；之后可随时迁移到文件夹。</div>
            </button>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setStep(mode === "fs" && supported ? "folders" : "ai")}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-paper hover:opacity-90"
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {step === "folders" && (
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-ink-faint">② 授权两个文件夹（相互独立）</p>
            <FolderPick
              label="阅读产物文件夹"
              hint="建议指向 Obsidian 库内的目录 —— 注释、对话、摘录会写成 markdown 存这里"
              handle={productDir}
              onPick={async () => setProductDir((await pickDirectory("aireader-product")) ?? productDir)}
            />
            <FolderPick
              label="运行状态文件夹"
              hint="放在知识库之外的任意位置 —— 存书籍文件、阅读进度等机器状态（JSON）"
              handle={stateDir}
              onPick={async () => setStateDir((await pickDirectory("aireader-state")) ?? stateDir)}
            />
            <div className="mt-5 flex justify-between">
              <button onClick={() => setStep("mode")} className="text-sm text-ink-faint hover:text-ink">
                返回
              </button>
              <button
                onClick={() => setStep("ai")}
                disabled={!stateDir || !productDir}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {step === "ai" && (
          <div className="mt-6">
            <p className="mb-3 text-xs font-medium text-ink-faint">③ AI 配置（也可以先跳过，之后在设置里填）</p>
            <label className="mb-1 block text-xs text-ink-soft">提供商</label>
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as ProviderId;
                setProvider(p);
                setModel(MODEL_PRESETS[p][0] ?? "");
              }}
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            >
              {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
            {provider === "custom" && (
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Base URL，如 https://api.example.com/v1"
                className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
              />
            )}
            <label className="mb-1 mt-3 block text-xs text-ink-soft">API key（只存本机浏览器，不上传不入库）</label>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
            <label className="mb-1 mt-3 block text-xs text-ink-soft">模型 ID</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="wizard-models"
              className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            />
            <datalist id="wizard-models">
              {MODEL_PRESETS[provider].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="mt-5 flex justify-between">
              <button
                onClick={() => setStep(mode === "fs" && supported ? "folders" : "mode")}
                className="text-sm text-ink-faint hover:text-ink"
              >
                返回
              </button>
              <button
                onClick={finish}
                disabled={busy}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "初始化…" : key.trim() ? "完成" : "跳过并完成"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FolderPick({
  label,
  hint,
  handle,
  onPick,
}: {
  label: string;
  hint: string;
  handle: FileSystemDirectoryHandle | null;
  onPick: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">
          {label}
          {handle && <span className="ml-2 text-xs text-accent">✓ {handle.name}</span>}
        </div>
        <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>
      </div>
      <button
        onClick={onPick}
        className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-accent-soft"
      >
        {handle ? "重选" : "选择"}
      </button>
    </div>
  );
}
