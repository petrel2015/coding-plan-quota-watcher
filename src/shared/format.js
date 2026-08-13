// 格式化工具函数（从 render.js / common.js 抽取，ES module）
// 时间 / 时长 / 数字单位均按当前 locale 翻译；日期标签中英文格式不同。
import { t, getLocale } from "./i18n.js";

// HTML 转义，防止用户/API 返回的内容注入
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 数字单位：中文用「万」，英文用 k / M
export function formatNum(n) {
  if (getLocale() === "zh") {
    if (n >= 10000) return (n / 10000).toFixed(2) + "万";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return n.toFixed(1);
  }
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toFixed(1);
}

export function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 相对时间：「刚刚」/「X 秒前」/「X 分钟前」/「X 小时前」/「X 天前」
export function formatRelativeTime(ts) {
  if (!ts) return "-";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return t("format.justNow");
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return t("format.justNow");
  if (sec < 60) return t("format.secondsAgo", { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t("format.minutesAgo", { n: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("format.hoursAgo", { n: hr });
  const day = Math.floor(hr / 24);
  return t("format.daysAgo", { n: day });
}

// 月/日 + 时:分 的本地化标签（中文「3月5日 14:30」，英文「Mar 5, 14:30」）
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDateLabel(date) {
  const mo = date.getMonth();
  const d = date.getDate();
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  if (getLocale() === "zh") return `${mo + 1}月${d}日 ${hh}:${mm}`;
  return `${EN_MONTHS[mo]} ${d}, ${hh}:${mm}`;
}

export function formatCountdown(ms) {
  if (ms <= 0) return t("format.reset");
  const totalSec = Math.floor(ms / 1000);
  const dd = Math.floor(totalSec / 86400);
  const hh = Math.floor((totalSec % 86400) / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const dateStr = formatDateLabel(new Date(Date.now() + ms));
  let dur;
  if (dd > 0) dur = t("format.dh", { d: dd, h: hh, m: mm });
  else if (hh > 0) dur = t("format.hm", { h: hh, m: mm });
  else if (mm > 0) dur = t("format.ms", { m: mm, s: ss });
  else dur = t("format.s", { s: ss });
  return `${dur} · ${dateStr}`;
}

// 只返回时长，不带日期
export function formatDuration(ms) {
  if (ms <= 0) return t("format.duration0");
  const totalSec = Math.floor(ms / 1000);
  const dd = Math.floor(totalSec / 86400);
  const hh = Math.floor((totalSec % 86400) / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  if (dd > 0) return t("format.dh", { d: dd, h: hh, m: mm });
  if (hh > 0) return t("format.hm", { h: hh, m: mm });
  return t("format.durM", { m: mm });
}

export function pad(n) {
  return String(n).padStart(2, "0");
}
