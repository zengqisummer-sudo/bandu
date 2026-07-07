import ePub from "epubjs";
import type { BookMeta, ContentType, TocItem } from "../../types/models";
import { storage } from "../storage";
import { paths } from "../storage/paths";
import { nowIso, sanitizeFileName, sha256Hex } from "../../lib/utils";

interface NavItem {
  label: string;
  href: string;
  subitems?: NavItem[];
}

interface SpineLike {
  get(target: string | number): { index: number } | null;
  spineItems?: { index: number; href: string }[];
}

function resolveSpineIndex(spine: SpineLike, href: string): number {
  const clean = href.split("#")[0];
  try {
    const s = spine.get(clean);
    if (s) return s.index;
  } catch {
    /* fall through */
  }
  const items = spine.spineItems ?? [];
  const hit = items.find((si) => si.href === clean || si.href.endsWith("/" + clean) || clean.endsWith(si.href));
  return hit ? hit.index : -1;
}

function mapToc(items: NavItem[], spine: SpineLike): TocItem[] {
  return items.map((it) => ({
    label: (it.label ?? "").trim() || "（无标题）",
    spine: resolveSpineIndex(spine, it.href ?? ""),
    children: it.subitems?.length ? mapToc(it.subitems, spine) : [],
  }));
}

export async function importEpub(
  file: File,
  contentType: ContentType,
  existingProductDirs: string[]
): Promise<{ meta: BookMeta; already: boolean }> {
  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const id = `b-${hash.slice(0, 12)}`;

  const existing = await storage().readJson<BookMeta>("state", paths.book(id));
  if (existing) return { meta: existing, already: true };

  const book = ePub(buffer);
  await book.ready;
  const metadata = await book.loaded.metadata;
  const nav = await book.loaded.navigation;
  const spine = book.spine as unknown as SpineLike;
  const spineLength = spine.spineItems?.length ?? 0;
  if (!spineLength) {
    book.destroy();
    throw new Error("epub 解析失败：没有可读章节");
  }

  const title = (metadata.title ?? "").trim() || file.name.replace(/\.epub$/i, "");
  const author = (metadata.creator ?? "").trim();

  // 产物子目录名：书名清洗，重名加 id 后缀
  let productDir = sanitizeFileName(title);
  if (existingProductDirs.includes(productDir)) productDir = `${productDir} ${id.slice(2, 8)}`;

  // 封面
  let coverFile: string | undefined;
  try {
    const coverUrl = await book.coverUrl();
    if (coverUrl) {
      const blob = await (await fetch(coverUrl)).blob();
      const ext = blob.type === "image/png" ? ".png" : blob.type === "image/gif" ? ".gif" : ".jpg";
      coverFile = `cover${ext}`;
      await storage().writeStateBinary(paths.cover(id, coverFile), blob);
    }
  } catch {
    /* 无封面不阻塞导入 */
  }

  const meta: BookMeta = {
    version: 1,
    id,
    title,
    author,
    contentType,
    epubHash: hash,
    importedAt: nowIso(),
    spineLength,
    toc: mapToc((nav?.toc ?? []) as NavItem[], spine),
    productDir,
    coverFile,
  };

  await storage().writeStateBinary(paths.epub(id), buffer);
  await storage().writeStateJson(paths.book(id), meta);
  book.destroy();
  return { meta, already: false };
}
