import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ContentType, ProviderId } from "../../types/models";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore, toast } from "../../stores/uiStore";
import { Modal } from "../common/Modal";
import {
  MODEL_PRESETS,
  PROVIDER_LABELS,
  getApiKey,
  setApiKey,
  resolveAiConfig,
  testConnection,
} from "../../services/ai/client";
import { DEFAULT_PROMPTS } from "../../services/ai/prompts";
import { loadHandles, pickDirectory } from "../../services/storage/handles";

export function SettingsModal() {
  const open = useUiStore((s) => s.settingsOpen);
  const close = useUiStore((s) => s.closeSettings);
  return (
    <Modal open={open} onClose={close} title="设置" wide>
      <AiSection />
      <hr className="my-5 border-line" />
      <StorageSection />
      <hr className="my-5 border-line" />
      <PromptsSection />
      <hr className="my-5 border-line" />
      <ContextSection />
    </Modal>
  );
}

/* ---------------- AI 提供商 ---------------- */

function AiSection() {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const provider = settings.ai.provider;
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    setKey(getApiKey(provider));
    setModel(provider === "custom" ? settings.ai.custom.model : settings.ai[provider].model);
    setBaseUrl(settings.ai.custom.baseUrl);
    setTestResult(null);
  }, [provider, settings.ai]);

  const commitModel = () => {
    const m = model.trim();
    if (provider === "deepseek") void saveSettings({ ai: { ...settings.ai, deepseek: { model: m || "deepseek-v4-flash" } } });
    else if (provider === "anthropic") void saveSettings({ ai: { ...settings.ai, anthropic: { model: m || "claude-sonnet-5" } } });
    else void saveSettings({ ai: { ...settings.ai, custom: { ...settings.ai.custom, model: m } } });
  };

  const doTest = async () => {
    commitModel();
    setTesting(true);
    setTestResult(null);
    const cfg = resolveAiConfig(useSettingsStore.getState().settings);
    if (!cfg) {
      setTestResult("✕ 请先填写 API key（自定义端点还需 Base URL 与模型）");
      setTesting(false);
      return;
    }
    const r = await testConnection(cfg);
    setTestResult(`${r.ok ? "✓" : "✕"} ${r.message}`);
    setTesting(false);
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">AI 提供商</h3>
      <div className="flex gap-2">
        {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
          <button
            key={p}
            onClick={() => void saveSettings({ ai: { ...settings.ai, provider: p } })}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              provider === p ? "border-accent bg-accent-soft" : "border-line text-ink-soft hover:border-ink-faint"
            }`}
          >
            {PROVIDER_LABELS[p]}
          </button>
        ))}
      </div>

      {provider === "custom" && (
        <Field label="Base URL（OpenAI 兼容，如 https://api.example.com/v1）">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            onBlur={() => void saveSettings({ ai: { ...settings.ai, custom: { ...settings.ai.custom, baseUrl: baseUrl.trim() } } })}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            placeholder="https://…"
          />
        </Field>
      )}

      <Field label={`API key（只存本机浏览器 localStorage，不进任何文件/Git）`}>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setApiKey(provider, e.target.value.trim());
            }}
            placeholder="sk-…"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
          <button
            onClick={() => setShowKey((v) => !v)}
            className="shrink-0 rounded-lg border border-line px-3 text-xs text-ink-soft hover:bg-accent-soft"
          >
            {showKey ? "隐藏" : "显示"}
          </button>
        </div>
      </Field>

      <Field label="模型 ID（可直接输入，以提供商官方文档为准）">
        <div className="flex gap-2">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onBlur={commitModel}
            list="settings-models"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
          <datalist id="settings-models">
            {MODEL_PRESETS[provider].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button
            onClick={() => void doTest()}
            disabled={testing}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-ink-soft hover:bg-accent-soft disabled:opacity-50"
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>
      </Field>
      {testResult && (
        <p className={`mt-2 text-xs ${testResult.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>{testResult}</p>
      )}
    </section>
  );
}

/* ---------------- 存储 ---------------- */

function StorageSection() {
  const mode = useSettingsStore((s) => s.mode);
  const adoptFolders = useSettingsStore((s) => s.adoptFolders);
  const migrateToFolders = useSettingsStore((s) => s.migrateToFolders);
  const [names, setNames] = useState<{ state?: string; product?: string }>({});

  useEffect(() => {
    void loadHandles().then((h) => setNames({ state: h.state?.name, product: h.product?.name }));
  }, [mode]);

  const changeFolder = async (which: "state" | "product") => {
    const picked = await pickDirectory(`aireader-${which}`);
    if (!picked) return;
    const h = await loadHandles();
    const state = which === "state" ? picked : h.state;
    const product = which === "product" ? picked : h.product;
    if (state && product) {
      await adoptFolders(state, product);
      toast("success", "文件夹已更换");
    }
  };

  const migrate = async () => {
    toast("info", "先选「阅读产物文件夹」（Obsidian 库内），再选「运行状态文件夹」（库外）");
    const product = await pickDirectory("aireader-product");
    if (!product) return;
    const state = await pickDirectory("aireader-state");
    if (!state) return;
    await migrateToFolders(state, product);
  };

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">数据存储</h3>
      {mode === "fs" ? (
        <>
          <FolderRow label="阅读产物文件夹（markdown，Obsidian 可索引）" name={names.product} onChange={() => void changeFolder("product")} />
          <FolderRow label="运行状态文件夹（JSON / epub / 缓存）" name={names.state} onChange={() => void changeFolder("state")} />
          <p className="mt-2 text-xs text-ink-faint">
            注释/对话/摘录只会追加写入，不覆盖你在 Obsidian 里的手动编辑。
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft">当前为浏览器模式：数据存在浏览器 IndexedDB 中，清除站点数据会丢失。</p>
          <button
            onClick={() => void migrate()}
            className="mt-3 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90"
          >
            切换到文件夹模式并迁移全部数据
          </button>
        </>
      )}
    </section>
  );
}

function FolderRow({ label, name, onChange }: { label: string; name?: string; onChange: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-xs text-ink-soft">{label}</div>
        <div className="mt-0.5 truncate text-sm">{name ?? "（未设置）"}</div>
      </div>
      <button onClick={onChange} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-accent-soft">
        更换
      </button>
    </div>
  );
}

/* ---------------- Prompt 编辑 ---------------- */

const TYPE_TABS: { id: ContentType; label: string }[] = [
  { id: "novel", label: "小说" },
  { id: "poetry", label: "诗歌" },
  { id: "social", label: "社科" },
];

const SCENE_LABELS = { chapter: "章节导读", hints: "随文注释", passage: "段落深挖", chat: "对话" } as const;

function PromptsSection() {
  const prompts = useSettingsStore((s) => s.prompts);
  const savePromptSet = useSettingsStore((s) => s.savePromptSet);
  const [type, setType] = useState<ContentType>("novel");
  const [draft, setDraft] = useState(prompts[type]);

  useEffect(() => {
    setDraft(useSettingsStore.getState().prompts[type]);
  }, [type, prompts]);

  const save = async () => {
    await savePromptSet(type, draft);
    toast("success", "Prompt 已保存");
  };

  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Prompt 配置</h3>
      <p className="mb-3 text-xs text-ink-faint">留空即使用内置默认（显示为灰色提示文字）。注释粒度、语气都在这里调。</p>
      <div className="mb-3 flex gap-2">
        {TYPE_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              type === t.id ? "border-accent bg-accent-soft" : "border-line text-ink-soft hover:border-ink-faint"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(Object.keys(SCENE_LABELS) as (keyof typeof SCENE_LABELS)[]).map((scene) => (
        <Field key={scene} label={SCENE_LABELS[scene]}>
          <textarea
            value={draft[scene]}
            onChange={(e) => setDraft({ ...draft, [scene]: e.target.value })}
            placeholder={DEFAULT_PROMPTS[type][scene]}
            rows={4}
            className="w-full resize-y rounded-lg border border-line bg-paper px-3 py-2 text-xs leading-relaxed outline-none focus:border-accent"
          />
        </Field>
      ))}
      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={() => setDraft({ chapter: "", passage: "", chat: "", hints: "" })}
          className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-accent-soft"
        >
          恢复默认
        </button>
        <button onClick={() => void save()} className="rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-paper hover:opacity-90">
          保存
        </button>
      </div>
    </section>
  );
}

/* ---------------- 上下文与生成 ---------------- */

function ContextSection() {
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">上下文与生成</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="前文窗口字数（注释/对话携带）">
          <input
            type="number"
            min={1000}
            max={30000}
            step={500}
            value={settings.contextChars}
            onChange={(e) => void saveSettings({ contextChars: Math.max(500, Number(e.target.value) || 6000) })}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
        </Field>
        <Field label="章节导读最长送入字数">
          <input
            type="number"
            min={2000}
            max={50000}
            step={1000}
            value={settings.chapterNoteMaxChars}
            onChange={(e) => void saveSettings({ chapterNoteMaxChars: Math.max(2000, Number(e.target.value) || 12000) })}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm"
          />
        </Field>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.autoChapterNote}
          onChange={(e) => void saveSettings({ autoChapterNote: e.target.checked })}
        />
        打开新章节时自动生成章节导读
      </label>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.autoChapterHints}
          onChange={(e) => void saveSettings({ autoChapterHints: e.target.checked })}
        />
        打开新章节时自动生成随文注释
        <span className="text-xs text-ink-faint">（整章送 AI，消耗较大；关闭时可在注释面板手动生成）</span>
      </label>
      <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={settings.logAiRequests}
          onChange={(e) => void saveSettings({ logAiRequests: e.target.checked })}
        />
        <span>
          是否打印请求 AI 的日志
          <span className="block text-xs text-ink-faint">
            开启后，每次请求大模型的 prompt 与返回都会追加写入运行状态文件夹，一本书一份（books/&lt;书&gt;/ai-请求日志.md），方便调 prompt、排查解析失败。默认关闭。
          </span>
        </span>
      </label>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <label className="mb-1 block text-xs text-ink-soft">{label}</label>
      {children}
    </div>
  );
}
