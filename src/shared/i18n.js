// 轻量 i18n：零依赖，shared 纯函数与 Vue 组件共用同一个 t()
// 语言跟随浏览器：navigator.language 以 zh 开头 → 中文，否则英文。
// Node / 测试环境无 navigator → 兜底中文（测试可用 setLocale 覆盖）。
//
// 设计要点：shared 层（diagnose / render / format / sources）是纯 JS 函数，
// 在 service worker 与单测里都要跑，用不了 Vue 实例的 $t，因此这里提供
// 语言无关的 t()，所有调用点（含 .vue 组件）统一使用。

import zh from "./locales/zh.js";
import en from "./locales/en.js";

const messages = { zh, en };
export const SUPPORTED_LOCALES = ["zh", "en"];
const DEFAULT_LOCALE = "zh";

// 把任意语言标签（"zh-CN"/"en-US"/"zh-Hant"…）归一到支持的两种之一
function normalizeLang(lang) {
  if (!lang || typeof lang !== "string") return DEFAULT_LOCALE;
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

// 探测浏览器语言：优先 navigator.languages[0]，回退 navigator.language
export function detectLocale() {
  try {
    if (typeof navigator === "undefined") return DEFAULT_LOCALE;
    const langs = navigator.languages || [];
    const lang = langs[0] || navigator.language || "";
    return normalizeLang(lang);
  } catch {
    return DEFAULT_LOCALE;
  }
}

let currentLocale = detectLocale();

export function getLocale() {
  return currentLocale;
}

export function setLocale(lang) {
  if (SUPPORTED_LOCALES.includes(lang)) currentLocale = lang;
}

// 翻译：t("card.refresh") 或 t("diag.serverError.title", { status: 500 })
// 找不到 key 时回退到默认语言，仍找不到则返回 key 本身并告警。
export function t(key, params) {
  const dict = messages[currentLocale] || messages[DEFAULT_LOCALE];
  let str = dict[key];
  if (str === undefined) str = messages[DEFAULT_LOCALE][key];
  if (str === undefined) {
    if (typeof console !== "undefined") console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (params) {
    str = str.replace(/\{(\w+)\}/g, (_, k) =>
      params[k] !== undefined && params[k] !== null ? String(params[k]) : `{${k}}`,
    );
  }
  return str;
}
