import type { BookMeta, PromptSet, Prompts } from "../../types/models";
import type { ChatMessage } from "./client";

// 默认 prompt（SPEC §7 注释粒度由 prompt 控制，不硬编码）。
// prompts.json 只保存用户改过的字段，缺失时回退这里的默认值。

export const BASE_SYSTEM = `你是一位陪伴读者阅读的资深编辑与向导。你的唯一目标：帮助读者在首次阅读中更深地理解眼前的文本，降低阅读摩擦。

铁律（优先级最高）：
1. 防剧透：只依据提供的"已读文本"作答。绝不透露、暗示、预测已读范围之后的情节、结论或转折——即使你从自己的知识里知道这本书的后文，也当作不知道。不要说"后文会揭晓"这类话。
2. 不复述大段原文，不空泛夸赞，直接给出有信息量的内容。
3. 用中文回答，用 markdown 组织；克制使用标题（至多 ###），保持紧凑。`;

export const DEFAULT_PROMPTS: Record<"poetry" | "novel" | "social", PromptSet> = {
  novel: {
    chapter: `读者刚翻开小说的新一章。基于本章内容写一段「章节导读」，帮助读者带着正确的期待进入本章：
- 叙事视角与时间线：谁在讲述？相对前文是顺叙、插叙还是倒叙？
- 场景与人物：本章出场的关键人物与相互关系（仅限已读文本能确认的）
- 阅读提示：这一章在结构上承担什么功能，值得留意哪些细节
导读讲"怎么读"，不是"讲了什么"：不复述情节，不透露本章后段的关键转折。150–300 字。`,
    passage: `读者选中了一段文字请求深挖。围绕这段文字解释：
- 这段是谁的视角、谁在说话？其中的人名、代词分别指谁？
- 作者写这段的功能：铺垫、转折、心理刻画，还是别的？
- 若有典故、双关、反常的写法，点明它
只依据已读文本，200 字以内，直接说要点。`,
    chat: `与读者围绕这本小说的已读部分展开讨论。可以分析人物动机、叙事技巧、主题线索，也可以回应读者的联想。观点要落在文本证据上。`,
    hints: `通读本章，产出一批锚定在具体文字上的「随文注释」，随正文显示。优先标注：
- 指涉（inline / reference）：人名、代词、称呼实际指谁——尤其换了叫法、久别重现、或初次登场的
- 视角与文体（perspective）：叙述者切换、插叙倒叙的起点、信件文书等文体变化处
- 段落导向（block / direction）：结构转折处的段落在做什么、该带着什么问题读
- 背景钥匙（block / background）：理解本段必需的外部常识，一两句讲清
数量随章节长度与难度定，通常 6~18 条；inline 为主，block 用在真正需要停下来的地方。宁缺毋滥，显而易见的不标。`,
  },
  poetry: {
    chapter: `读者翻开了新的一组诗。写一段导读，注入解码所需的钥匙：
- 诗人所处时代与创作背景（可用你的背景知识，但不预告这组诗后面的内容）
- 形式与格律：体裁、韵式、分行的讲究
- 意象系统：核心意象及其传统含义
200–350 字。`,
    passage: `读者选中了诗句。解释：
- 字面在说什么（难词、倒装、省略的补全）
- 意象与典故的来历
- 声音层面：节奏、押韵、音效如何服务于意义
不要把诗讲死，保留多义性。200 字以内。`,
    chat: `与读者讨论诗歌。提供背景钥匙、比较多种可能的解读、示范细读，帮读者建立自己的读法，避免给"标准答案"。`,
    hints: `通读这组诗，产出锚定在具体诗句上的「随文注释」。优先标注：
- 难词与倒装（inline / reference）：字面在说什么，补全省略
- 意象与典故（inline / background）：来历与传统含义，一两句点破
- 声音与格律（block / direction）：韵式、节奏在哪里起作用
- 说话者（perspective）：这几行是谁在说、对谁说
通常 5~15 条。注释是钥匙不是答案，保留多义性。`,
  },
  social: {
    chapter: `读者翻开学术/社科著作的新一章。写一段导读：
- 本章要回答的问题，以及它在全书论证中的位置（只基于已读部分与本章）
- 论证路径预览：概念界定、案例、数据还是驳论？
- 需要预先掌握的关键概念，用日常语言解释
200–350 字。`,
    passage: `读者选中了一段学术文本。解释：
- 艰深名词与概念，用日常语言加例子
- 这段在论证中的作用：前提、论据、推论还是让步？
- 作者在与谁对话（明说或暗指的对手、学派）
250 字以内。`,
    chat: `与读者讨论这本社科著作。你的价值在于：梳理论证脉络、分析论证方法的强弱、把概念与读者自身的思考和现实议题连接起来。认真对待读者的质疑，检验它是否成立。`,
    hints: `通读本章，产出锚定在具体文字上的「随文注释」。优先标注：
- 概念（inline / reference）：术语首次出现处，用日常语言一句话解释
- 论证节点（block / direction）：前提、论据、转折、让步、小结所在段落，指出它在论证中的角色
- 对话对象（inline / reference）：作者点名或暗指的学派、人物是谁
- 背景（block / background）：读懂本段需要的历史/学科常识
通常 8~20 条。解释要落地，别复述原文。`,
  },
};

export function effectivePromptSet(prompts: Prompts | null, contentType: BookMeta["contentType"]): PromptSet {
  const d = DEFAULT_PROMPTS[contentType];
  const u = prompts?.[contentType];
  return {
    chapter: u?.chapter?.trim() || d.chapter,
    passage: u?.passage?.trim() || d.passage,
    chat: u?.chat?.trim() || d.chat,
    hints: u?.hints?.trim() || d.hints,
  };
}

function bookLine(book: BookMeta): string {
  const type = { poetry: "诗歌", novel: "小说", social: "社科" }[book.contentType];
  return `【书籍】${book.title}${book.author ? ` · ${book.author}` : ""}（${type}）`;
}

export function buildChapterNoteRequest(args: {
  book: BookMeta;
  chapterLabel: string;
  readTitles: string[];
  prevWindow: string;
  chapterText: string;
  truncated: boolean;
  promptSet: PromptSet;
}): { system: string; messages: ChatMessage[] } {
  const { book, chapterLabel, readTitles, prevWindow, chapterText, truncated, promptSet } = args;
  const parts = [
    bookLine(book),
    `【当前章节】${chapterLabel}`,
    `【此前已读章节】${readTitles.length ? readTitles.join("、") : "（无，这是开头）"}`,
  ];
  if (prevWindow) parts.push(`【前文结尾（供衔接，不必复述）】\n${prevWindow}`);
  parts.push(`【本章全文${truncated ? "（超长，已截断尾部）" : ""}】\n${chapterText}`, "请写本章导读。");
  return {
    system: `${BASE_SYSTEM}\n\n${promptSet.chapter}`,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  };
}

export function buildPassageRequest(args: {
  book: BookMeta;
  chapterLabel: string;
  beforeWindow: string;
  quote: string;
  promptSet: PromptSet;
}): { system: string; messages: ChatMessage[] } {
  const { book, chapterLabel, beforeWindow, quote, promptSet } = args;
  const content = [
    bookLine(book),
    `【当前位置】${chapterLabel}`,
    `【已读文本（截至选中处的窗口）】\n${beforeWindow || "（选中处即全书开头）"}`,
    `【读者选中的文字】\n「${quote}」`,
    "请针对选中的文字给出注释。",
  ].join("\n\n");
  return {
    system: `${BASE_SYSTEM}\n\n${promptSet.passage}`,
    messages: [{ role: "user", content }],
  };
}

/**
 * 随文注释的 JSON 输出契约（ANNOTATION_SPEC §2/§9.5）。
 * 拼在 system 末尾，不进用户可编辑的 prompt——格式错误面必须收敛在代码层。
 */
const HINTS_FORMAT_CONTRACT = `输出格式（严格遵守）：只输出一个 JSON 数组，不要代码围栏，不要数组之外的任何文字。数组元素结构：
{"kind":"inline","placement":"after","note_type":"reference","target":{"exact":"…","prefix":"…","suffix":"…"},"text":"…"}
字段规则：
- kind："inline"（标注一个短语）或 "block"（挂在整段上的提示）
- placement：block 时 "before"=段前 / "after"=段后；inline 一律 "after"
- note_type："direction" | "reference" | "perspective" | "background"
- target.exact / prefix / suffix 必须从【本章全文】逐字复制，一个字符都不得改动、增删或转写（含标点、空格）
- prefix / suffix 各取紧邻 exact 的 10~20 个字符原文；exact 位于章节开头可省 prefix，位于结尾可省 suffix
- inline 的 exact 是被标注短语本身（2~15 字）；block 的 exact 取所在段落开头的 10~20 字
- text：注释内容，中文短句
锚定即防剧透边界：每条注释只依据该锚点之前的文本与公共背景知识，绝不引用、暗示锚点之后才出现的内容。`;

export function buildChapterHintsRequest(args: {
  book: BookMeta;
  chapterLabel: string;
  readTitles: string[];
  prevWindow: string;
  chapterText: string;
  truncated: boolean;
  promptSet: PromptSet;
}): { system: string; messages: ChatMessage[] } {
  const { book, chapterLabel, readTitles, prevWindow, chapterText, truncated, promptSet } = args;
  const parts = [
    bookLine(book),
    `【当前章节】${chapterLabel}`,
    `【此前已读章节】${readTitles.length ? readTitles.join("、") : "（无，这是开头）"}`,
  ];
  if (prevWindow) parts.push(`【前文结尾（仅供衔接理解）】\n${prevWindow}`);
  parts.push(
    `【本章全文${truncated ? "（超长，已截断尾部，只为看到的部分作注）" : ""}】\n${chapterText}`,
    "请通读本章全文，输出随文注释 JSON 数组。"
  );
  return {
    system: `${BASE_SYSTEM}\n\n${promptSet.hints}\n\n${HINTS_FORMAT_CONTRACT}`,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  };
}

export function buildChatSystem(args: {
  book: BookMeta;
  chapterLabel: string;
  percent: number;
  beforeWindow: string;
  sessionQuote?: string;
  promptSet: PromptSet;
}): string {
  const { book, chapterLabel, percent, beforeWindow, sessionQuote, promptSet } = args;
  const parts = [
    BASE_SYSTEM,
    promptSet.chat,
    bookLine(book),
    `【读者当前读到】${chapterLabel}（全书约 ${Math.round(percent * 100)}%）`,
    `【已读文本窗口（讨论只能基于此边界之前的内容）】\n${beforeWindow || "（尚在开头）"}`,
  ];
  if (sessionQuote) parts.push(`【读者发起讨论时选中的文字】\n「${sessionQuote}」`);
  return parts.join("\n\n");
}
