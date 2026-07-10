import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base 用相对路径，构建产物可部署在任意子路径（GitHub Pages 等）
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @apache-annotator/dom 的 css 模块引 optimal-select，而后者 "module" 字段
      // 指向未随包发布的 src/，解析必挂。指回真实存在的 CJS 入口。
      // 本应用只用 TextQuoteSelector 匹配与 highlightText，不用 CSS selector 功能。
      "optimal-select": "optimal-select/lib/index.js",
    },
  },
});
