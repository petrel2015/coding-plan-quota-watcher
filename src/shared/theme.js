// 主题管理（light / dark / auto 三档，持久化到 storage）

// 从 storage 读取主题并应用到 <html data-theme>，应在页面初始化时尽早调用
export async function applyTheme() {
  const { theme } = await chrome.storage.local.get("theme");
  setThemeAttr(theme || "auto");
}

// 设置 <html data-theme> 属性（auto 时不设属性，回退到 CSS media query）
export function setThemeAttr(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    // auto：移除属性，让 CSS @media 接管
    document.documentElement.removeAttribute("data-theme");
  }
}
