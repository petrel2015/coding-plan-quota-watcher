// 版本号同步：以 package.json 为唯一真源，把 version 写进 manifest.json。
// 用法：node scripts/sync-version.mjs
// 在 build / package 前 npm script 里自动调用，避免两边版本号不一致。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifestPath = resolve(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.version === pkg.version) {
  console.log(`[sync-version] 版本一致：${pkg.version}（无需更新 manifest.json）`);
  process.exit(0);
}

manifest.version = pkg.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`[sync-version] manifest.json 版本已同步为 ${pkg.version}`);
