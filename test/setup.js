// vitest 全局 setup：固定中文 locale
// node 环境无 navigator，i18n 默认兜底即为 zh；这里显式固定，
// 让现有基于中文文案的断言（render/diagnose/sources）与浏览器语言无关、稳定。
import { setLocale } from "../src/shared/i18n.js";

setLocale("zh");
