import { forwardRef, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { toBlob, toPng } from "html-to-image";
import type { Excerpt } from "../../types/models";
import { useReaderStore } from "../../stores/readerStore";
import { Modal } from "../common/Modal";
import { toast } from "../../stores/uiStore";
import { dateStr, sanitizeFileName } from "../../lib/utils";

// 摘录分享图。模板用写死的配色/字体，不跟随应用亮暗主题，保证导出稳定。
// 所有模板兼容任意开关组合（书名/作者/日期）与任意长度的摘录文本。

const SERIF = `'Noto Serif SC','Source Han Serif SC','SimSun',Georgia,serif`;
const KAI = `'KaiTi','Kaiti SC','STKaiti','SimKai',${SERIF}`;

const CARD_W = 640;

interface Template {
  id: string;
  name: string;
  swatch: CSSProperties; // 选择器上的小色块
  outer: CSSProperties;
  inner?: CSSProperties;
  mark?: { char: string; style: CSSProperties }; // 装饰引号
  quote: CSSProperties;
  meta: CSSProperties; // —— 作者《书名》
  date: CSSProperties;
  divider?: CSSProperties;
}

const TEMPLATES: Template[] = [
  {
    id: "sujian",
    name: "素笺",
    swatch: { background: "#faf7ef", border: "1px solid #d8d0bd" },
    outer: { background: "#faf7ef", padding: "26px" },
    inner: { border: "1px solid #d8d0bd", outline: "1px solid #d8d0bd", outlineOffset: "4px", padding: "44px 42px 34px" },
    mark: { char: "「", style: { fontFamily: SERIF, fontSize: "44px", lineHeight: 1, color: "#b9a778", marginBottom: "14px" } },
    quote: { fontFamily: SERIF, color: "#33302a" },
    meta: { fontFamily: SERIF, color: "#7a715c", textAlign: "right" },
    date: { color: "#b0a68d", textAlign: "right" },
  },
  {
    id: "xuanmo",
    name: "玄墨",
    swatch: { background: "#1e1b17" },
    outer: { background: "radial-gradient(120% 120% at 20% 0%, #2a2620 0%, #1a1713 70%)", padding: "56px 48px 40px" },
    mark: { char: "❝", style: { fontSize: "40px", lineHeight: 1, color: "#c9a86a", marginBottom: "16px" } },
    quote: { fontFamily: SERIF, color: "#eae3d0" },
    divider: { borderTop: "1px solid rgba(201,168,106,0.45)", width: "56px", margin: "28px 0 16px" },
    meta: { fontFamily: SERIF, color: "#c9a86a" },
    date: { color: "#847a63" },
  },
  {
    id: "nuanyang",
    name: "暖阳",
    swatch: { background: "linear-gradient(135deg,#f7e8c8,#eecfa0)" },
    outer: { background: "linear-gradient(160deg,#faf0da 0%, #f3ddb4 100%)", padding: "26px" },
    inner: { background: "rgba(255,253,247,0.72)", borderRadius: "18px", padding: "42px 40px 32px", boxShadow: "0 8px 30px rgba(140,100,40,0.10)" },
    mark: { char: "❞", style: { fontSize: "38px", lineHeight: 1, color: "#c78d3b", marginBottom: "14px" } },
    quote: { fontFamily: KAI, color: "#4a3a22" },
    meta: { fontFamily: KAI, color: "#96702f", textAlign: "right" },
    date: { color: "#bfa678", textAlign: "right" },
  },
  {
    id: "qingci",
    name: "青瓷",
    swatch: { background: "linear-gradient(135deg,#dcebe4,#b9d2c8)" },
    outer: { background: "linear-gradient(150deg,#e3efe8 0%, #bfd6cc 100%)", padding: "30px" },
    inner: { background: "#ffffff", borderRadius: "6px", padding: "44px 42px 32px", boxShadow: "0 10px 34px rgba(50,90,75,0.16)", borderTop: "3px solid #57806f" },
    quote: { fontFamily: SERIF, color: "#2e3833" },
    divider: { borderTop: "1px solid #cfe0d8", width: "100%", margin: "26px 0 16px" },
    meta: { fontFamily: SERIF, color: "#57806f" },
    date: { color: "#9fb5ab" },
  },
];

/** 摘录长度 → 正文字号（模板兼容长文的关键） */
function quoteFontSize(len: number): number {
  if (len <= 60) return 26;
  if (len <= 150) return 22;
  if (len <= 300) return 19;
  return 16;
}

interface Options {
  template: string;
  title: boolean;
  author: boolean;
  date: boolean;
}

const OPT_KEY = "aireader.excerptCard.v1";

function loadOptions(): Options {
  try {
    const v = JSON.parse(localStorage.getItem(OPT_KEY) ?? "");
    if (v && typeof v === "object") return { template: "sujian", title: true, author: true, date: false, ...v };
  } catch {
    /* 首次使用 */
  }
  return { template: "sujian", title: true, author: true, date: false };
}

export function ExcerptImageModal({ ex, onClose }: { ex: Excerpt; onClose: () => void }) {
  const book = useReaderStore((s) => s.book);
  const [opts, setOpts] = useState<Options>(loadOptions);
  const [busy, setBusy] = useState<"png" | "copy" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const setOpt = (patch: Partial<Options>) => {
    setOpts((o) => {
      const next = { ...o, ...patch };
      try {
        localStorage.setItem(OPT_KEY, JSON.stringify(next));
      } catch {
        /* 无妨 */
      }
      return next;
    });
  };

  if (!book) return null;
  const tpl = TEMPLATES.find((t) => t.id === opts.template) ?? TEMPLATES[0];

  const exportPng = async () => {
    if (!cardRef.current) return;
    setBusy("png");
    try {
      const url = await toPng(cardRef.current, { pixelRatio: 2 });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFileName(book.title)}-摘录-${dateStr()}.png`;
      a.click();
      toast("success", "已导出图片");
    } catch (e) {
      toast("error", `导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const copyPng = async () => {
    if (!cardRef.current) return;
    setBusy("copy");
    try {
      const blob = await toBlob(cardRef.current, { pixelRatio: 2 });
      if (!blob) throw new Error("生成图片失败");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("success", "已复制到剪贴板");
    } catch (e) {
      toast("error", `复制失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={busy ? () => {} : onClose} title="导出摘录图片" wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => setOpt({ template: t.id })}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              t.id === tpl.id ? "border-accent bg-accent-soft" : "border-line text-ink-soft hover:border-ink-faint"
            }`}
          >
            <span className="inline-block h-4 w-4 rounded" style={t.swatch} />
            {t.name}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" />
        <OptCheck label="书名" checked={opts.title} onChange={(v) => setOpt({ title: v })} />
        <OptCheck label="作者" checked={opts.author} onChange={(v) => setOpt({ author: v })} disabled={!book.author} />
        <OptCheck label="日期" checked={opts.date} onChange={(v) => setOpt({ date: v })} />
      </div>

      <ScaledPreview>
        <ExcerptCardArt
          ref={cardRef}
          tpl={tpl}
          quote={ex.quote}
          title={opts.title ? book.title : ""}
          author={opts.author ? book.author : ""}
          date={opts.date ? dateStr(ex.createdAt) : ""}
        />
      </ScaledPreview>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={() => void copyPng()}
          disabled={!!busy}
          className="rounded-lg border border-line px-4 py-2 text-sm text-ink-soft hover:border-accent hover:text-ink disabled:opacity-40"
        >
          {busy === "copy" ? "复制中…" : "复制图片"}
        </button>
        <button
          onClick={() => void exportPng()}
          disabled={!!busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40"
        >
          {busy === "png" ? "导出中…" : "下载 PNG"}
        </button>
      </div>
    </Modal>
  );
}

function OptCheck({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1 text-xs ${disabled ? "opacity-40" : "cursor-pointer text-ink-soft"}`}>
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/** 预览等比缩放到容器宽度（导出时抓取未缩放的卡片节点，不受影响） */
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const update = () => {
      const s = Math.min(1, box.clientWidth / CARD_W);
      setScale(s);
      setH(inner.offsetHeight * s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(box);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="overflow-hidden rounded-lg border border-line" style={{ height: h || undefined }}>
      <div ref={innerRef} style={{ width: CARD_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

const ExcerptCardArt = forwardRef<
  HTMLDivElement,
  { tpl: Template; quote: string; title: string; author: string; date: string }
>(function ExcerptCardArt({ tpl, quote, title, author, date }, ref) {
  const fontSize = quoteFontSize(quote.length);
  const paras = quote
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const metaText = [author, title ? `《${title}》` : ""].filter(Boolean).join(" ");

  return (
    <div ref={ref} style={{ width: CARD_W, boxSizing: "border-box", ...tpl.outer }}>
      <div style={{ boxSizing: "border-box", ...(tpl.inner ?? {}) }}>
        {tpl.mark && <div style={tpl.mark.style}>{tpl.mark.char}</div>}
        <div style={{ fontSize, lineHeight: 1.9, letterSpacing: "0.02em", ...tpl.quote }}>
          {paras.map((p, i) => (
            <p key={i} style={{ margin: i ? "0.8em 0 0" : 0 }}>
              {p}
            </p>
          ))}
        </div>
        {tpl.divider && (metaText || date) && <div style={tpl.divider} />}
        {(metaText || date) && (
          <div style={{ marginTop: tpl.divider ? 0 : "30px" }}>
            {metaText && <div style={{ fontSize: 15, lineHeight: 1.7, ...tpl.meta }}>—— {metaText}</div>}
            {date && (
              <div style={{ fontSize: 12, lineHeight: 1.8, marginTop: metaText ? 2 : 0, ...tpl.date }}>{date}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
