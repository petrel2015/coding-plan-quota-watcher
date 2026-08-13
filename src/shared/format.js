// 格式化工具函数（从 render.js / common.js 抽取，ES module）

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

export function formatNum(n) {
  if (n >= 10000) return (n / 10000).toFixed(2) + "万";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toFixed(1);
}

export function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 相对时间:"刚刚" / "X 秒前" / "X 分钟前" / "X 小时前" / "X 天前"
export function formatRelativeTime(ts) {
  if (!ts) return "-";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "刚刚";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

export function formatCountdown(ms) {
  if (ms <= 0) return "已重置";
  const totalSec = Math.floor(ms / 1000);
  const dd = Math.floor(totalSec / 86400);
  const hh = Math.floor((totalSec % 86400) / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const t = new Date(Date.now() + ms);
  const dateStr = `${t.getMonth() + 1}月${t.getDate()}日 ${pad(t.getHours())}:${pad(t.getMinutes())}`;
  let dur;
  if (dd > 0) dur = `${dd}天${hh}时${mm}分`;
  else if (hh > 0) dur = `${hh}时${mm}分`;
  else if (mm > 0) dur = `${mm}分${ss}秒`;
  else dur = `${ss}秒`;
  return `${dur} · ${dateStr}`;
}

// 只返回时长，不带日期
export function formatDuration(ms) {
  if (ms <= 0) return "0分";
  const totalSec = Math.floor(ms / 1000);
  const dd = Math.floor(totalSec / 86400);
  const hh = Math.floor((totalSec % 86400) / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  if (dd > 0) return `${dd}天${hh}时${mm}分`;
  if (hh > 0) return `${hh}时${mm}分`;
  return `${mm}分`;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}
