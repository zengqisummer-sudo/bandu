/** Ideas have their own vocabulary. Excerpt tags and their localStorage are never read here. */
const TOPIC_VOCAB_KEY = "aireader.topics.v1";

export function normalizeTopic(raw: string): string | null {
  const value = raw.trim().replace(/^#+/, "").replace(/[\r\n\t]+/g, " ");
  return value || null;
}

export function ideaTopics(idea: { topics?: string[]; tags?: string[] }): string[] {
  // Compatibility only for old idea records; never imports the excerpt tag vocabulary.
  return [...new Set((idea.topics ?? idea.tags ?? []).map(normalizeTopic).filter((x): x is string => !!x))];
}

function readTopics(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TOPIC_VOCAB_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function recordTopicUse(topics: string[]): void {
  const values = [...new Set([...topics, ...readTopics()].map(normalizeTopic).filter((x): x is string => !!x))];
  try { localStorage.setItem(TOPIC_VOCAB_KEY, JSON.stringify(values)); } catch { /* Suggestions are optional. */ }
}

export function suggestTopics(query: string, available: string[], exclude: string[]): string[] {
  const q = query.trim().toLocaleLowerCase();
  return [...new Set([...available, ...readTopics()])]
    .filter(t => !exclude.includes(t) && t.toLocaleLowerCase().includes(q))
    .sort((a, b) => Number(b.toLocaleLowerCase().startsWith(q)) - Number(a.toLocaleLowerCase().startsWith(q)) || a.localeCompare(b))
    .slice(0, 8);
}

export function topicLine(topics: string[]): string {
  return topics.length ? `话题：${topics.join(" · ")}` : "";
}
