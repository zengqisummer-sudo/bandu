import { create } from "zustand";
import type { ContentType, PromptSet, Prompts, Settings } from "../types/models";
import {
  getStorageMode,
  makeFsaProviderFromSaved,
  makeIdbProvider,
  migrateIdbToFs,
  setProvider,
  setStorageMode,
} from "../services/storage";
import { FsaProvider } from "../services/storage/fsa";
import { storage, storageReady } from "../services/storage";
import { hasPermission, loadHandles, pickDirectory, requestPermission, saveHandles } from "../services/storage/handles";
import { paths } from "../services/storage/paths";
import { toast } from "./uiStore";

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  ai: {
    provider: "deepseek",
    deepseek: { model: "deepseek-v4-flash" },
    anthropic: { model: "claude-sonnet-5" },
    custom: { baseUrl: "", model: "" },
  },
  contextChars: 6000,
  chapterNoteMaxChars: 12000,
  autoChapterNote: true,
  autoChapterHints: false,
  reading: { fontSize: 18, lineHeight: 1.9, maxWidth: 720, theme: "light" },
};

const EMPTY_PROMPT_SET: PromptSet = { chapter: "", passage: "", chat: "", hints: "" };

const EMPTY_PROMPTS: Prompts = {
  version: 1,
  poetry: { ...EMPTY_PROMPT_SET },
  novel: { ...EMPTY_PROMPT_SET },
  social: { ...EMPTY_PROMPT_SET },
};

/** 磁盘上的 prompts.json 可能来自旧版本（缺 hints 等字段），逐字段补齐 */
function mergePrompts(loaded: Partial<Prompts> | null): Prompts {
  if (!loaded) return EMPTY_PROMPTS;
  const one = (s?: Partial<PromptSet>): PromptSet => ({ ...EMPTY_PROMPT_SET, ...s });
  return { version: 1, poetry: one(loaded.poetry), novel: one(loaded.novel), social: one(loaded.social) };
}

function mergeSettings(loaded: Partial<Settings> | null): Settings {
  if (!loaded) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...loaded.ai,
      deepseek: { ...DEFAULT_SETTINGS.ai.deepseek, ...loaded.ai?.deepseek },
      anthropic: { ...DEFAULT_SETTINGS.ai.anthropic, ...loaded.ai?.anthropic },
      custom: { ...DEFAULT_SETTINGS.ai.custom, ...loaded.ai?.custom },
    },
    reading: { ...DEFAULT_SETTINGS.reading, ...loaded.reading },
  };
}

function applyTheme(settings: Settings) {
  document.documentElement.dataset.theme = settings.reading.theme;
}

export type BootState = "booting" | "wizard" | "fs-restore" | "ready";

interface SettingsState {
  bootState: BootState;
  mode: "fs" | "idb" | null;
  fsMissing: "handles" | "permission" | null;
  settings: Settings;
  prompts: Prompts;
  init(): Promise<void>;
  chooseIdbMode(): Promise<void>;
  /** 向导内：两个目录都已选好后调用 */
  adoptFolders(state: FileSystemDirectoryHandle, product: FileSystemDirectoryHandle): Promise<void>;
  restoreFsAccess(): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  savePromptSet(type: ContentType, ps: PromptSet): Promise<void>;
  /** 浏览器模式 → 文件夹模式，迁移全部数据 */
  migrateToFolders(state: FileSystemDirectoryHandle, product: FileSystemDirectoryHandle): Promise<void>;
}

async function loadPersisted(set: (p: Partial<SettingsState>) => void) {
  const s = await storage().readJson<Settings>("state", paths.settings);
  const p = await storage().readJson<Prompts>("state", paths.prompts);
  const settings = mergeSettings(s);
  applyTheme(settings);
  set({ settings, prompts: mergePrompts(p) });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  bootState: "booting",
  mode: null,
  fsMissing: null,
  settings: DEFAULT_SETTINGS,
  prompts: EMPTY_PROMPTS,

  async init() {
    applyTheme(DEFAULT_SETTINGS);
    const mode = getStorageMode();
    if (!mode) {
      set({ bootState: "wizard" });
      return;
    }
    if (mode === "idb") {
      setProvider(makeIdbProvider());
      await loadPersisted(set);
      set({ mode, bootState: "ready" });
      return;
    }
    // fs 模式
    const handles = await loadHandles();
    if (!handles.state || !handles.product) {
      set({ mode, fsMissing: "handles", bootState: "fs-restore" });
      return;
    }
    if (!(await hasPermission(handles.state)) || !(await hasPermission(handles.product))) {
      set({ mode, fsMissing: "permission", bootState: "fs-restore" });
      return;
    }
    setProvider(await makeFsaProviderFromSaved());
    await loadPersisted(set);
    set({ mode, fsMissing: null, bootState: "ready" });
  },

  async chooseIdbMode() {
    setStorageMode("idb");
    setProvider(makeIdbProvider());
    await loadPersisted(set);
    set({ mode: "idb", bootState: "ready" });
  },

  async adoptFolders(state, product) {
    await saveHandles({ state, product });
    setStorageMode("fs");
    setProvider(new FsaProvider(state, product));
    await loadPersisted(set);
    set({ mode: "fs", fsMissing: null, bootState: "ready" });
  },

  async restoreFsAccess() {
    const handles = await loadHandles();
    if (!handles.state || !handles.product) {
      // 句柄丢失，重新选目录
      const state = await pickDirectory("aireader-state");
      if (!state) return;
      const product = await pickDirectory("aireader-product");
      if (!product) return;
      await get().adoptFolders(state, product);
      return;
    }
    const ok = (await requestPermission(handles.state)) && (await requestPermission(handles.product));
    if (!ok) {
      toast("error", "未获得文件夹访问权限");
      return;
    }
    setProvider(new FsaProvider(handles.state, handles.product));
    await loadPersisted(set);
    set({ fsMissing: null, bootState: "ready" });
  },

  async saveSettings(patch) {
    const settings = mergeSettings({ ...get().settings, ...patch });
    applyTheme(settings);
    set({ settings });
    if (storageReady()) await storage().writeStateJson(paths.settings, settings);
  },

  async savePromptSet(type, ps) {
    const prompts: Prompts = { ...get().prompts, [type]: ps };
    set({ prompts });
    if (storageReady()) await storage().writeStateJson(paths.prompts, prompts);
  },

  async migrateToFolders(state, product) {
    const fsa = new FsaProvider(state, product);
    const r = await migrateIdbToFs(fsa);
    await saveHandles({ state, product });
    setStorageMode("fs");
    setProvider(fsa);
    await loadPersisted(set);
    set({ mode: "fs", fsMissing: null, bootState: "ready" });
    toast("success", `已迁移 ${r.written} 个文件${r.skipped ? `，跳过已存在的 ${r.skipped} 个` : ""}`);
  },
}));
