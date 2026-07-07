// 全部持久化数据结构（对应 SPEC §1.2 / §1.3）

export type ContentType = "poetry" | "novel" | "social";
export type ProviderId = "deepseek" | "anthropic" | "custom";

export interface AiSettings {
  provider: ProviderId;
  deepseek: { model: string };
  anthropic: { model: string };
  custom: { baseUrl: string; model: string };
}

export interface ReadingPrefs {
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  theme: "light" | "dark";
}

export interface Settings {
  version: 1;
  ai: AiSettings;
  contextChars: number;
  chapterNoteMaxChars: number;
  autoChapterNote: boolean;
  reading: ReadingPrefs;
}

export interface PromptSet {
  chapter: string;
  passage: string;
  chat: string;
}

export interface Prompts {
  version: 1;
  poetry: PromptSet;
  novel: PromptSet;
  social: PromptSet;
}

export interface TocItem {
  label: string;
  spine: number; // 解析失败为 -1
  children: TocItem[];
}

export interface BookMeta {
  version: 1;
  id: string;
  title: string;
  author: string;
  contentType: ContentType;
  epubHash: string;
  importedAt: string;
  spineLength: number;
  toc: TocItem[];
  productDir: string;
  coverFile?: string; // books/{id}/ 下的封面文件名
}

export interface Progress {
  version: 1;
  spine: number;
  anchor: { para: number };
  percent: number;
  updatedAt: string;
}

// 锚点：para/endPara 为章内块序号，start/end 为块内 textContent 字符偏移
export interface Anchor {
  para: number;
  start: number;
  endPara: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Annotation {
  id: string;
  kind: "chapter" | "passage";
  spine: number;
  anchor: Anchor | null; // chapter 级为 null
  content: string;
  createdAt: string;
}

export interface AnnotationsFile {
  version: 1;
  items: Annotation[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  t: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  context: { spine: number; percent: number; quote?: string };
  turns: ChatTurn[];
  lastSavedTurn: number; // 已写入 md 的轮数
}

export interface ConversationsFile {
  version: 1;
  sessions: ChatSession[];
  lastWrittenSession?: string; // md 中最后写入的会话，用于判断是否补"（续）"头
}

export type ExcerptSource = "manual" | "kindle" | "text";

export interface Excerpt {
  id: string;
  spine: number; // 未定位为 -1
  anchor: Anchor | null;
  quote: string;
  note?: string;
  source: ExcerptSource;
  createdAt: string;
}

export interface ExcerptsFile {
  version: 1;
  items: Excerpt[];
}

export interface ChapterCache {
  version: 1;
  href: string; // epub 内章节路径，渲染时解析图片等资源用
  html: string; // 消毒后的 HTML（资源路径保持 epub 内原样）
  paras: string[]; // 各块的 textContent（与渲染 DOM 的块序号一一对应）
}
