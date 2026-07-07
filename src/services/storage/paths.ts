// 逻辑路径统一用 "/" 分隔，由各 provider 自行落地

export const paths = {
  settings: "settings.json",
  prompts: "prompts.json",
  book: (id: string) => `books/${id}/book.json`,
  epub: (id: string) => `books/${id}/book.epub`,
  cover: (id: string, file: string) => `books/${id}/${file}`,
  progress: (id: string) => `books/${id}/progress.json`,
  annotations: (id: string) => `books/${id}/annotations.json`,
  conversations: (id: string) => `books/${id}/conversations.json`,
  excerpts: (id: string) => `books/${id}/excerpts.json`,
  bookDir: (id: string) => `books/${id}`,
  chapterCache: (id: string, spine: number) =>
    `books/${id}/cache/chapters/${String(spine).padStart(4, "0")}.json`,
  // 产物区（相对产物根）
  productNotes: (dir: string) => `${dir}/注释.md`,
  productChats: (dir: string) => `${dir}/对话.md`,
  productExcerpts: (dir: string) => `${dir}/摘录.md`,
};
