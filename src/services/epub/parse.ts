import ePub, { Book } from "epubjs";
import DOMPurify from "dompurify";
import type { ChapterCache } from "../../types/models";
import { storage } from "../storage";
import { paths } from "../storage/paths";
import { collectBlocks } from "../anchor/anchor";

// epub 实例池：阅读一本书期间保持打开（archive 里的图片等资源需要它）
const instances = new Map<string, Book>();

export async function openEpub(id: string): Promise<Book> {
  const existing = instances.get(id);
  if (existing) return existing;
  const buf = await storage().readBinary("state", paths.epub(id));
  if (!buf) throw new Error("找不到 epub 文件，请重新导入");
  const book = ePub(buf);
  await book.ready;
  instances.set(id, book);
  return book;
}

export function closeEpub(id: string) {
  instances.get(id)?.destroy();
  instances.delete(id);
}

export const SANITIZE_OPTS = {
  // 去掉样式与交互类标签，排版由应用统一控制
  FORBID_TAGS: ["style", "link", "script", "meta", "title", "head", "base", "form", "input", "button", "iframe", "object", "embed", "video", "audio", "nav"],
  FORBID_ATTR: ["style", "class", "id"],
};

/**
 * 加载章节：优先读解析缓存；否则从 epub 解出 → 消毒 → 缓存。
 * 缓存中的 html 保留 epub 内原始资源路径（blob URL 跨会话无效），渲染时再解析。
 */
export async function loadChapter(bookId: string, spine: number): Promise<ChapterCache> {
  const cachePath = paths.chapterCache(bookId, spine);
  const cached = await storage().readJson<ChapterCache>("state", cachePath);
  if (cached && cached.version === 1) return cached;

  const book = await openEpub(bookId);
  const section = book.spine.get(spine);
  if (!section) throw new Error(`章节不存在（spine ${spine}）`);
  await section.load(book.load.bind(book));
  const doc = section.document as Document | undefined;
  const raw = doc?.body?.innerHTML ?? "";
  const clean = DOMPurify.sanitize(raw, SANITIZE_OPTS);

  const tpl = document.createElement("div");
  tpl.innerHTML = clean;
  // 去掉链接跳转（脚注/内链在自绘阅读器中无处可去），保留文字
  tpl.querySelectorAll("a").forEach((a) => a.removeAttribute("href"));
  const blocks = collectBlocks(tpl);
  const paras = blocks.map((b) => b.textContent ?? "");

  const cache: ChapterCache = { version: 1, href: section.href, html: tpl.innerHTML, paras };
  section.unload();
  try {
    await storage().writeStateJson(cachePath, cache);
  } catch (e) {
    console.warn("章节缓存写入失败", e);
  }
  return cache;
}

/** 章节纯文本（AI 上下文、摘录匹配用） */
export async function chapterText(bookId: string, spine: number): Promise<string[]> {
  const c = await loadChapter(bookId, spine);
  return c.paras;
}

/** 渲染后解析章内资源：img / svg image 的相对路径 → archive blob URL */
export async function resolveResources(container: HTMLElement, bookId: string, sectionHref: string) {
  const book = await openEpub(bookId);
  const archive = (book as unknown as { archive?: { createUrl(p: string, o: { base64: boolean }): Promise<string> } }).archive;
  if (!archive) return;
  const dir: string = (book as unknown as { container?: { directory?: string } }).container?.directory ?? "";

  const zipPaths = (rel: string): string[] => {
    try {
      const u = new URL(rel, "http://epub/" + sectionHref);
      const fromSection = decodeURIComponent(u.pathname.replace(/^\//, ""));
      const candidates = [`/${dir ? dir + "/" : ""}${fromSection}`, `/${fromSection}`];
      return [...new Set(candidates)];
    } catch {
      return [];
    }
  };

  const rewrite = async (el: Element, attr: string) => {
    const val = el.getAttribute(attr);
    if (!val || val.startsWith("blob:") || val.startsWith("data:") || val.startsWith("http")) return;
    for (const zp of zipPaths(val)) {
      try {
        const url = await archive.createUrl(zp, { base64: false });
        el.setAttribute(attr, url);
        return;
      } catch {
        /* 尝试下一个候选路径 */
      }
    }
    el.removeAttribute(attr); // 全部失败则去掉，避免碎图标
  };

  const jobs: Promise<void>[] = [];
  container.querySelectorAll("img").forEach((img) => jobs.push(rewrite(img, "src")));
  container.querySelectorAll("image").forEach((im) => {
    jobs.push(rewrite(im, im.hasAttribute("xlink:href") ? "xlink:href" : "href"));
  });
  await Promise.all(jobs);
}
