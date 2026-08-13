// 错误诊断（纯函数）：把 background fetch 抛出的原始 error 归类成结构化结果，
// 供 dashboard / settings 展示「类别 + 详情 + 可操作建议」。
// background 和前端共用，避免两处各写一套翻译。
//
// 注意：background 抛出的 Error.message 是给本函数归类的「协议串」，保持英文稳定，
// 不做 i18n；本函数输出的 title/detail/advice 才走 i18n（按当前 locale 翻译）。
// 平台响应 body（sliceBody 切出的原文）不翻译，原样展示。
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
import { t } from "./i18n.js";

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

// 按 authMode 选「重新登录」还是「重新粘贴 cookie」的措辞，可选拼接 extra 说明
function reauthAdvice(authMode, extra = "") {
  const base = t(authMode === "manual" ? "diag.reauthManual" : "diag.reauthLocal");
  return extra ? base + t("common.paren", { s: extra }) : base;
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

  // —— 1. 网络层失败：Failed to fetch（fetch API 抛的 TypeError / Chrome 原生错误）——
  if (/failed to fetch|networkerror|load failed|err_(connection|name)_/i.test(message)) {
    const hosts = collectHosts(type, urls);
    const detail =
      hosts.length > 0
        ? t("diag.network.detailHost", { hosts: hosts.join(" / ") })
        : t("diag.network.detailNoHost");
    return {
      category: "network",
      title: t("diag.network.title"),
      detail,
      advice: t("diag.network.advice"),
      authMode,
    };
  }

  // —— 1b. 请求超时（fetchWithDnrCookie 的 AbortController 超时）——
  if (/timeout|timed?\s*out|aborterror/i.test(message)) {
    const hosts = collectHosts(type, urls);
    const detail =
      hosts.length > 0
        ? t("diag.timeout.detailHost", { hosts: hosts.join(" / ") })
        : t("diag.timeout.detailNoHost");
    return {
      category: "timeout",
      title: t("diag.timeout.title"),
      detail,
      advice: t("diag.timeout.advice"),
      authMode,
    };
  }

  // —— 2. csrfToken 缺失（仅 volcengine-ark，local/manual 各一条 message）——
  if (/csrf.*not\s*found|csrftoken not found/i.test(message)) {
    return {
      category: "auth_missing",
      title: t("diag.authMissing.title"),
      detail: t("diag.authMissing.detail"),
      advice:
        authMode === "manual"
          ? t("diag.authMissing.adviceManual")
          : t("diag.authMissing.adviceLocal"),
      authMode,
    };
  }

  // —— 3. ChatGPT accessToken 获取失败（session 失效）——
  if (/cannot get.*accesstoken|possibly not logged in/i.test(message)) {
    return {
      category: "auth_expired",
      title: t("diag.chatgptExpired.title"),
      detail: t("diag.chatgptExpired.detail"),
      advice: reauthAdvice(authMode, t("diag.chatgptExpired.extra")),
      authMode,
    };
  }

  // —— 4. Token 接口 HTTP xxx（ChatGPT session 接口返回非 2xx）——
  const tokenStatusMatch = message.match(/token\s*endpoint\s*http\s*(\d+)/i);

  // —— 5. 通用 HTTP xxx: body ——
  const httpStatusMatch = tokenStatusMatch || message.match(/http\s*(\d+)/i);
  if (httpStatusMatch) {
    const status = parseInt(httpStatusMatch[1], 10);
    const isTokenPhase = !!tokenStatusMatch;
    if (status === 401 || status === 419 || status === 440) {
      return {
        category: "auth_expired",
        title: t("diag.expired401.title"),
        detail: isTokenPhase ? t("diag.expired401.detailToken") : sliceBody(message),
        advice: reauthAdvice(authMode),
        authMode,
      };
    }
    if (status === 403) {
      return {
        category: "forbidden",
        title: t("diag.forbidden.title"),
        detail: sliceBody(message) || t("diag.forbidden.detailFallback"),
        advice: t("diag.forbidden.advice"),
        authMode,
      };
    }
    if (status === 404) {
      return {
        category: "bad_response",
        title: t("diag.notFound.title"),
        detail: t("diag.notFound.detail"),
        advice: t("diag.notFound.advice"),
        authMode,
      };
    }
    if (status === 429) {
      return {
        category: "rate_limited",
        title: t("diag.rateLimit.title"),
        detail: t("diag.rateLimit.detail"),
        advice: t("diag.rateLimit.advice"),
        authMode,
      };
    }
    if (status >= 500 && status < 600) {
      return {
        category: "server_error",
        title: t("diag.serverError.title", { status }),
        detail: sliceBody(message) || t("diag.serverError.detailFallback"),
        advice: t("diag.serverError.advice"),
        authMode,
      };
    }
    if (status >= 400 && status < 500) {
      return {
        category: "bad_response",
        title: t("diag.badRequest.title", { status }),
        detail: sliceBody(message) || t("diag.badRequest.detailFallback"),
        advice: t("diag.badRequest.advice"),
        authMode,
      };
    }
  }

  // —— 6. JSON 解析失败（响应不是 JSON，多为 HTML 登录页重定向）——
  if (/unexpected token|json|is not valid json|syntaxerror/i.test(message) && /unexpected token|[a-z]+ is not valid json/i.test(message)) {
    return {
      category: "bad_response",
      title: t("diag.badResponse.title"),
      detail: t("diag.badResponse.detail"),
      advice: reauthAdvice(authMode, t("diag.badResponse.extra")),
      authMode,
    };
  }

  // —— 7. 未知数据源类型（配置损坏）——
  if (/unknown source type/i.test(message)) {
    return {
      category: "unknown",
      title: t("diag.unknown.title"),
      detail: message,
      advice: t("diag.unknown.advice"),
      authMode,
    };
  }

  // —— 8. 兜底 ——
  return {
    category: "unknown",
    title: t("diag.fallback.title"),
    detail: message || t("diag.fallback.detailFallback"),
    advice: t("diag.fallback.advice"),
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
