import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => {
    const raw = marked.parse(text || "", { async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [text]);
  return (
    <div
      className={`md-body ${streaming ? "stream-cursor" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
