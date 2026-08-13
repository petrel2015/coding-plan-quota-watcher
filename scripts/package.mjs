// 打包脚本：sync-version → build → 打 zip 到 releases/
// 产物：releases/coding-plan-quota-watcher-<version>.zip
// zip 内容 = 项目根（含 manifest.json、dist/、icons/、*.html、common.css 等），
// 排除 node_modules / .git / test / releases / *.pem / *.crx / dev 临时文件 等。
//
// 用法：npm run package
// 跨平台：优先用系统 zip（macOS/Linux），回退到 tar（Windows 10+ 自带 zip 支持）。
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releasesDir = resolve(root, "releases");

// 不打进 zip 的顶层条目（开发文件，运行时扩展不需要）
const EXCLUDE_TOP = new Set([
  "node_modules",
  ".git",
  "test",
  "releases",
  ".vscode",
  ".idea",
  ".zcode",
  "scripts",
  "src", // 运行时用 dist/ 产物，不需要源码
  "vite.config.js",
  "package.json",
  "package-lock.json",
  "element-overrides.css", // 已被 vite 打进 dist/assets/*.css，无需单独分发
  ".gitignore",
  ".DS_Store",
]);
const EXCLUDE_SUFFIXES = [".pem", ".crx", ".log"];
const EXCLUDE_FILES = new Set([".DS_Store"]);

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

function sh(cmd) {
  execSync(cmd, { stdio: "inherit", cwd: root });
}

step("1/4  同步版本号到 manifest.json");
sh("node scripts/sync-version.mjs");

step("2/4  构建（vite build → dist/）");
sh("npm run build");

step("3/4  打包 zip");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;
const zipName = `coding-plan-quota-watcher-${version}.zip`;
const zipPath = resolve(releasesDir, zipName);

if (!existsSync(releasesDir)) mkdirSync(releasesDir, { mode: 0o755 });
if (existsSync(zipPath)) rmSync(zipPath);

// 收集要打包的顶层条目（排除开发文件）
const entries = readdirSync(root)
  .filter((name) => {
    if (EXCLUDE_TOP.has(name)) return false;
    if (EXCLUDE_FILES.has(name)) return false;
    if (EXCLUDE_SUFFIXES.some((s) => name.endsWith(s))) return false;
    return true;
  })
  .map((name) => `"${name}"`)
  .join(" ");

// 选打包工具：系统 zip 优先（macOS/Linux），否则用 tar（Windows 10+）
const hasZip = (() => {
  try {
    execSync("zip --version > /dev/null 2>&1");
    return true;
  } catch {
    return false;
  }
})();

if (hasZip) {
  sh(
    `zip -r -X "${zipPath}" ${entries} ` +
      `-x "*.DS_Store" "*/node_modules/*" ".git/*" "*.pem" "*.crx" "*.log"`,
  );
} else {
  sh(
    `tar -a -c -f "${zipPath}" ` +
      `--exclude "*.DS_Store" --exclude "*/node_modules/*" --exclude ".git/*" ` +
      `--exclude "*.pem" --exclude "*.crx" --exclude "*.log" ` +
      entries,
  );
}

step("4/4  完成");
const sizeKb = (statSync(zipPath).size / 1024).toFixed(1);
console.log(`✓ 产物：releases/${zipName}  (${sizeKb} KB)`);
console.log(`  版本：${version}`);
console.log("  安装方式：解压后在 chrome://extensions 以「加载已解压的扩展程序」选择解压目录；");
console.log("           或上传该 zip 到 Chrome 应用商店。");
