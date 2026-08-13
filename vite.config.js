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
});
