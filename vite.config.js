import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue2";
import { resolve } from "path";

// MV3 扩展打包配置
// - settings / dashboard：Vue 2 SFC，打包成页面入口 JS + CSS
// - background：service worker，ES module，不打包 Vue
// 产物输出到 dist/，HTML 留根目录引用 dist/assets/*
export default defineConfig({
  plugins: [vue()],
  base: "./",
  resolve: {
    alias: {
      // 锁定 runtime-only 构建，杜绝运行时模板编译（MV3 禁 unsafe-eval）
      vue: "vue/dist/vue.runtime.esm.js",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // service worker 不参与 code-split，避免动态 import 导致多文件
    rollupOptions: {
      input: {
        settings: resolve(__dirname, "src/settings/main.js"),
        dashboard: resolve(__dirname, "src/dashboard/main.js"),
        background: resolve(__dirname, "src/background/main.js"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/chunks/[name]-[hash].js",
        // element-ui / vue 等第三方依赖固定进 theme 共享块：
        // 根目录 HTML 硬编码引用其抽离的 CSS（assets/theme.css），
        // 不固定块名会随 chunk 自动命名漂移（如引入 locale 后变成 en.css）
        manualChunks(id) {
          if (id.includes("node_modules")) return "theme";
          // 深色覆盖样式与 theme.js 是两页面共享的 UI 公共依赖，
          // 一并归入 theme 块，保证其 CSS 合并输出为单个 theme.css
          if (id.endsWith("shared/theme.js") || id.endsWith("element-overrides.css")) {
            return "theme";
          }
        },
        assetFileNames: (info) => {
          // Element-UI 字体分到 fonts 目录
          if (info.name && /\.(woff2?|ttf|eot)$/.test(info.name)) {
            return "assets/fonts/[name][extname]";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
  test: {
    setupFiles: ["./test/setup.js"],
  },
});
