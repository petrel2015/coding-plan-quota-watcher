// 错误诊断（纯函数）：把 background fetch 抛出的原始 error 归类成结构化结果，
// 供 dashboard / settings 展示中文化的「类别 + 详情 + 可操作建议」。
// background 和前端共用，避免两处各写一套翻译。
//
// 入参：
//   err      —— Error 对象 / string / { message }
//   options  —— { type?: string, authMode?: "local"|"manual", urls?: string[] }
//               type     数据源类型，用于在 urls 缺省时从 SOURCE_TEMPLATES 反查域名
//               authMode 决定 advice 措辞（local→重新登录，manual→重新粘贴 cookie）
//               urls     网络类错误时，从中解析 host 写进 detail（背景侧会传 tmpl.url/tokenEndpoint）
//
// 返回：
//   { category, title, detail, advice, authMode }

import { SOURCE_TEMPLATES } from "./sources.js";

// 从 url 字符串提取 host（hostname），失败返回 null
function hostOf(urlStr) {
  if (!urlStr) return null;
  try {
    return new URL(urlStr).hostname;
  } catch {
    return null;
  }
}

// 收集所有候选 host（urls 显式传入 + 按 type 从模板补 url/tokenEndpoint）
function collectHosts(type, urls) {
  const candidates = [];
  if (Array.isArray(urls)) candidates.push(...urls);
  const tmpl = SOURCE_TEMPLATES[type];
  if (tmpl) {
    if (tmpl.tokenEndpoint) candidates.push(tmpl.tokenEndpoint);
    if (tmpl.url) candidates.push(tmpl.url);
  }
  const hosts = [];
  const seen = new Set();
  for (const u of candidates) {
    const h = hostOf(u);
    if (h && !seen.has(h)) {
      seen.add(h);
      hosts.push(h);
    }
  }
  return hosts;
}

// 是否为「需要用户重新登录/补齐凭证」的终态错误（auth_expired / auth_missing）：
// 这类错误重试不会自愈，自动刷新时不应再触发转圈/进度条，静默展示错误即可。
export function isTerminalAuthDiag(diag) {
  return !!diag && (diag.category === "auth_expired" || diag.category === "auth_missing");
}

// 按 authMode 选「重新登录」还是「重新粘贴 cookie」的措辞
function reauthAdvice(authMode, extra = "") {
  const base =
    authMode === "manual"
      ? "Cookie 已过期或不完整，请重新从 DevTools → Network → Copy as cURL 粘贴"
      : "登录态已失效，请重新登录该平台";
  return extra ? `${base}（${extra}）` : base;
}

/**
 * 把原始 error 归类成结构化诊断结果。
 * @param {Error|string|{message:string}} err
 * @param {{type?:string, authMode?:string, urls?:string[]}} [options]
 */
export function diagnoseError(err, options = {}) {
  const { type, authMode, urls } = options;
  const message =
    err == null
      ? ""
      : typeof err === "string"
        ? err
        : typeof err.message === "string"
          ? err.message
          : String(err);

  // —— 1. 网络层失败：Failed to fetch（fetch API 抛的 TypeError）——
  if (/failed to fetch|networkerror|load failed|err_(connection|name)_/i.test(message)) {
    const hosts = collectHosts(type, urls);
    const detail =
      hosts.length > 0
        ? `无法访问 ${hosts.join(" / ")}（网络请求被拒绝）`
        : "网络请求无法发出（可能断网或被拦截）";
    return {
      category: "network",
      title: "网络不通",
      detail,
      advice:
        "请检查本机网络/代理能否打开该域名；公司内网、VPN 或代理可能拦截了对该站点的访问。",
      authMode,
    };
  }

  // —— 1b. 请求超时（fetchWithDnrCookie 的 AbortController 超时）——
  if (/请求超时|timeout|timed?\s*out|aborterror/i.test(message)) {
    const hosts = collectHosts(type, urls);
    const detail =
      hosts.length > 0
        ? `请求 ${hosts.join(" / ")} 在超时时间内无响应`
        : "请求在超时时间内无响应";
    return {
      category: "timeout",
      title: "请求超时",
      detail,
      advice:
        "目标站点响应过慢或连接被挂起。请检查网络是否稳定、代理是否正常；若持续超时，该平台可能临时不可达。",
      authMode,
    };
  }

  // —— 2. csrfToken 缺失（仅 volcengine-ark，local/manual 各一条 message）——
  if (/csrftoken not found|curl 中未找到.*csrf/i.test(message)) {
    return {
      category: "auth_missing",
      title: "缺少登录凭证",
      detail: "未取到 csrfToken，请求无法通过平台鉴权",
      advice:
        authMode === "manual"
          ? "cURL 不完整，请重新复制（需同时包含 cookie 与 x-csrf-token 头）"
          : "未检测到该平台的登录 Cookie，请先登录火山方舟控制台",
      authMode,
    };
  }

  // —— 3. ChatGPT accessToken 获取失败（session 失效）——
  if (/无法从.*获取.*accesstoken|可能未登录/i.test(message)) {
    return {
      category: "auth_expired",
      title: "ChatGPT 登录态失效",
      detail: "无法从 /api/auth/session 取到 accessToken",
      advice: reauthAdvice(authMode, "ChatGPT 会话已过期"),
      authMode,
    };
  }

  // —— 4. Token 接口 HTTP xxx（ChatGPT session 接口返回非 2xx）——
  const tokenStatusMatch = message.match(/token\s*接口\s*http\s*(\d+)/i);

  // —— 5. 通用 HTTP xxx: body ——
  const httpStatusMatch = tokenStatusMatch || message.match(/http\s*(\d+)/i);
  if (httpStatusMatch) {
    const status = parseInt(httpStatusMatch[1], 10);
    const isTokenPhase = !!tokenStatusMatch;
    if (status === 401 || status === 419 || status === 440) {
      return {
        category: "auth_expired",
        title: "登录已过期（401）",
        detail: isTokenPhase ? "鉴权接口返回 401" : sliceBody(message),
        advice: reauthAdvice(authMode),
        authMode,
      };
    }
    if (status === 403) {
      return {
        category: "forbidden",
        title: "无权限（403）",
        detail: sliceBody(message) || "平台拒绝了该请求",
        advice:
          "账号可能没有该套餐权限，或鉴权已失效；尝试重新登录/刷新 Cookie，确认账号已开通对应套餐。",
        authMode,
      };
    }
    if (status === 404) {
      return {
        category: "bad_response",
        title: "接口不存在（404）",
        detail: "请求的用量接口返回 404",
        advice: "数据源配置可能过时，或平台接口路径已变更。",
        authMode,
      };
    }
    if (status === 429) {
      return {
        category: "rate_limited",
        title: "请求过频（429）",
        detail: "触发了平台限流",
        advice: "稍后重试；如果频繁出现，请降低后台刷新频率。",
        authMode,
      };
    }
    if (status >= 500 && status < 600) {
      return {
        category: "server_error",
        title: `服务端异常（${status}）`,
        detail: sliceBody(message) || "平台侧返回错误",
        advice: "平台服务端故障，通常稍后重试即可恢复。",
        authMode,
      };
    }
    if (status >= 400 && status < 500) {
      return {
        category: "bad_response",
        title: `请求被拒绝（${status}）`,
        detail: sliceBody(message) || "平台返回了 4xx 错误",
        advice: "请查看返回内容确认原因；常见为参数或鉴权问题。",
        authMode,
      };
    }
  }

  // —— 6. JSON 解析失败（响应不是 JSON，多为 HTML 登录页重定向）——
  if (/unexpected token|json|is not valid json|syntaxerror/i.test(message) && /unexpected token|[a-z]+ is not valid json/i.test(message)) {
    return {
      category: "bad_response",
      title: "响应格式异常",
      detail: "平台返回了非 JSON 内容（可能是登录页重定向）",
      advice: reauthAdvice(authMode, "通常是登录态失效"),
      authMode,
    };
  }

  // —— 7. 未知数据源类型（配置损坏）——
  if (/未知数据源类型/i.test(message)) {
    return {
      category: "unknown",
      title: "配置异常",
      detail: message,
      advice: "该数据源类型不被支持，可能配置已损坏，请删除后重新添加。",
      authMode,
    };
  }

  // —— 8. 兜底 ——
  return {
    category: "unknown",
    title: "获取失败",
    detail: message || "未知错误",
    advice: "请稍后重试；若持续失败，可点击「测试连接」查看具体原因。",
    authMode,
  };
}

// 从 "HTTP xxx: <body>" 这类 message 里切出 body 部分（去掉前缀），最多 120 字
function sliceBody(message) {
  const m = message.match(/http\s*\d+\s*:\s*(.+)$/is);
  if (!m) return "";
  const body = m[1].trim();
  if (!body) return "";
  return body.length > 120 ? body.slice(0, 120) + "…" : body;
}
