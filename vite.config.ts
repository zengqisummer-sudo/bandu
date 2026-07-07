import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base 用相对路径，构建产物可部署在任意子路径（GitHub Pages 等）
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
