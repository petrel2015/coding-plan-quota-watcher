// background.js - Service Worker（ES module）
// 从 storage 读取实例配置，动态拉取数据，缓存到 storage
// 数据源模板从 shared/sources.js 引入（单一来源，与 Vue 组件共用）

import { SOURCE_TEMPLATES, DEFAULT_INSTANCES, migrateInstances } from "../shared/sources.js";
import { diagnoseError } from "../shared/diagnose.js";

const ALARM_NAME = "quota-refresh";
const REFRESH_INTERVAL_MINUTES = 5;
// 单次请求超时：覆盖发起到响应体读取完成的全程，
// 防止某请求挂起导致刷新链卡死、卡片永远转圈
const FETCH_TIMEOUT_MS = 20000;
// codex-reset.com 重置预测是锦上添花的数据，单独用更短的超时
const FORECAST_TIMEOUT_MS = 10000;
// 整轮刷新看门狗：即使个别请求因未知原因挂起，也保证 _refreshing 复位，
// 否则防重入守卫会把后续所有刷新静默跳过（表现为卡片永远「暂无数据」+转圈）
const REFRESH_ALL_TIMEOUT_MS = 120000;

// ------------------------------------------------------------
// DNR（declarativeNetRequest）助手
// ------------------------------------------------------------

// 清除所有残留动态规则
async function clearAllDnrRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  if (existing.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id),
    });
  }
}

// 动态 ruleId：1_000_000 ~ 2_000_000 之间递增，避开静态规则，杜绝并发冲突
let _nextRuleId = 1000000;
function allocRuleId() {
  const id = _nextRuleId;
  _nextRuleId = (_nextRuleId + 1) % 2000000;
  if (_nextRuleId < 1000000) _nextRuleId = 1000000;
  return id;
}

/**
 * 带整体超时的 fetch：从发起到响应体读取完成全程受控。
 * 只保护到响应头是不够的——服务器发出头部后挂起 body 时，
 * resp.json()/resp.text() 会永久 pending，卡死整条刷新链。
 * 返回 Response 的薄包装（ok/status 同名，json()/text() 读取完成才停表）。
 */
async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const asTimeoutError = (e) =>
    timedOut || (e && e.name === "AbortError")
      ? new Error(`Request timeout (${timeoutMs / 1000}s)`)
      : e;

  let resp;
  try {
    resp = await fetch(url, { ...opts, cache: "no-store", signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    throw asTimeoutError(e);
  }
  const readWithTimeout = (read) => async () => {
    try {
      return await read();
    } catch (e) {
      throw asTimeoutError(e);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    ok: resp.ok,
    status: resp.status,
    json: readWithTimeout(() => resp.json()),
    text: readWithTimeout(() => resp.text()),
  };
}

/**
 * 用 DNR 临时注入 Cookie 发起一次请求，结束后自动清理规则。
 * 请求本体（含超时保护）委托给 fetchWithTimeout。
 * @param {string} url        目标 URL（不含 _qwid）
 * @param {string} cookieStr  要注入的 Cookie 值
 * @param {object} fetchOpts  传给 fetch 的选项（method/headers/body 等）
 * @returns {Promise<{ok, status, json(), text()}>}
 */
async function fetchWithDnrCookie(url, cookieStr, fetchOpts) {
  const ruleId = allocRuleId();
  const qwid = `${ruleId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const bustUrl = new URL(url);
  bustUrl.searchParams.set("_qwid", qwid);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [{
      id: ruleId,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "cookie", operation: "set", value: cookieStr },
        ],
      },
      condition: {
        urlFilter: `_qwid=${qwid}`,
        resourceTypes: ["xmlhttprequest", "other"],
      },
    }],
  });

  try {
    return await fetchWithTimeout(bustUrl.toString(), fetchOpts);
  } finally {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
    }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log(`[QuotaWatcher v${chrome.runtime.getManifest().version}] installed`);
  await clearAllDnrRules();
  console.log("[QuotaWatcher] cleaned stale DNR rules");
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
  refreshAll();
});

// 点击扩展图标直接打开 dashboard
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshAll();
});

// 全局串行锁，确保同一时间只有一个 fetchInstance 在跑
let _fetchChain = Promise.resolve();
function serializeFetch(fn) {
  _fetchChain = _fetchChain.then(fn, fn);
  return _fetchChain;
}

// 读取全部 instances（带字段迁移），写回 storage 若有变化
async function loadAllInstances() {
  const result = await chrome.storage.local.get("instances");
  if (!result.instances) return [];
  const { instances, changed } = migrateInstances(result.instances);
  if (changed) {
    await chrome.storage.local.set({ instances });
    console.log("[QuotaWatcher] migrated manualCookie → manualCurl");
  }
  return instances;
}

async function getInstances() {
  const instances = await loadAllInstances();
  return instances.filter((i) => i.enabled);
}

let _refreshing = false;

async function refreshAll() {
  if (_refreshing) {
    console.log("[QuotaWatcher] refresh already in progress, skipping");
    return;
  }
  _refreshing = true;
  console.log("[QuotaWatcher] refreshing all...");
  try {
    const instances = await getInstances();
    // 并发刷新全部实例（各实例写独立的 data_<id> key，互不冲突）
    // 看门狗兜底：单请求超时已覆盖正常路径，这里再保一层 _refreshing 一定复位
    let watchdog;
    await Promise.race([
      Promise.all(instances.map((inst) => fetchAndStore(inst))),
      new Promise((resolve) => {
        watchdog = setTimeout(resolve, REFRESH_ALL_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(watchdog));
  } finally {
    _refreshing = false;
  }
}

// 刷新单个实例（卡片调用）
async function refreshOne(instanceId) {
  const instances = await loadAllInstances();
  const inst = instances.find((i) => i.id === instanceId && i.enabled);
  if (!inst) return;
  await serializeFetch(() => fetchAndStore(inst));
}

// 收集某数据源类型相关的候选 URL（用于网络错误时诊断出具体不通的域名）
function collectUrlsForType(type) {
  const tmpl = SOURCE_TEMPLATES[type];
  if (!tmpl) return [];
  const urls = [];
  if (tmpl.tokenEndpoint) urls.push(tmpl.tokenEndpoint);
  if (tmpl.url) urls.push(tmpl.url);
  return urls;
}

// 实际获取数据并存入 storage
async function fetchAndStore(inst) {
  try {
    const data = await fetchInstance(inst);
    await chrome.storage.local.set({
      [`data_${inst.id}`]: {
        ...data,
        _fetchedAt: Date.now(),
        _error: null,
        _lastError: null,
        _diag: null,
        _hasValidData: true,
        _name: inst.name,
        _type: inst.type,
      },
    });
    console.log(`[QuotaWatcher] ${inst.id} OK`);
  } catch (err) {
    console.error(`[QuotaWatcher] ${inst.id} error:`, err);
    const diag = diagnoseError(err, {
      type: inst.type,
      authMode: inst.authMode,
      urls: collectUrlsForType(inst.type),
    });
    const existing = await chrome.storage.local.get(`data_${inst.id}`);
    const oldData = existing[`data_${inst.id}`];
    if (oldData && oldData._hasValidData) {
      await chrome.storage.local.set({
        [`data_${inst.id}`]: {
          ...oldData,
          _lastError: err.message,
          _diag: diag,
        },
      });
      console.log(`[QuotaWatcher] ${inst.id} fetch failed, keeping last data`);
    } else {
      await chrome.storage.local.set({
        [`data_${inst.id}`]: {
          _fetchedAt: Date.now(),
          _error: err.message,
          _lastError: null,
          _diag: diag,
          _hasValidData: false,
          _name: inst.name,
          _type: inst.type,
        },
      });
    }
  }
}

async function fetchInstance(inst) {
  let tmpl = SOURCE_TEMPLATES[inst.type];
  if (!tmpl) throw new Error(`Unknown source type: ${inst.type}`);

  let cookieStr = "";
  let csrfToken = "";
  let extraHeaders = {};
  let authToken = "";

  if (inst.authMode === "manual" && inst.manualCurl) {
    // 手动粘贴 curl 模式：从 curl 命令中提取 URL、Cookie、csrfToken、body
    const parsed = parseCurl(inst.manualCurl);
    cookieStr = parsed.cookieStr;

    if (tmpl.csrfCookieName) {
      // 优先从 curl header 提取 csrfToken（parseCurl 已把 key 统一 lowercase）
      csrfToken = parsed.headers["x-csrf-token"] || "";
      // 如果 header 里没有，从 cookie 字符串提取
      if (!csrfToken) {
        const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${tmpl.csrfCookieName}=([^;]+)`));
        csrfToken = match ? match[1] : "";
      }
      if (!csrfToken) {
        throw new Error(`csrfToken not found in curl: ${tmpl.csrfCookieName} or X-Csrf-Token`);
      }
    }

    // 提取额外 header（从 cookie 字符串）
    if (tmpl.extraHeadersFromCookie) {
      for (const extra of tmpl.extraHeadersFromCookie) {
        const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${extra.cookieName}=([^;]+)`));
        if (match) extraHeaders[extra.headerName] = match[1];
      }
    }

    // 透传 curl 中的指定 header（如 authorization、oai-device-id 等）
    if (tmpl.preserveHeaders) {
      for (const h of tmpl.preserveHeaders) {
        if (parsed.headers[h]) {
          extraHeaders[h] = parsed.headers[h];
        }
      }
    }

    // 如果 curl 里有 body，覆盖模板的 body
    if (parsed.body !== undefined) {
      tmpl = { ...tmpl, body: parsed.body };
    }
    // 如果 curl 里有 URL，覆盖模板的 URL
    if (parsed.url) {
      tmpl = { ...tmpl, url: parsed.url };
    }
  } else {
    // 本地 cookie 模式：用 chrome.cookies API 读取
    const allCookies = [];
    const seen = new Set();

    // url 方式
    const cookiesByUrl = await chrome.cookies.getAll({ url: tmpl.url });
    for (const c of cookiesByUrl) {
      const key = `${c.name}@${c.domain}@${c.path}`;
      if (!seen.has(key)) { seen.add(key); allCookies.push(c); }
    }
    // domain 方式
    for (const d of tmpl.cookieDomains) {
      const cookies = await chrome.cookies.getAll({ domain: d });
      for (const c of cookies) {
        const key = `${c.name}@${c.domain}@${c.path}`;
        if (!seen.has(key)) { seen.add(key); allCookies.push(c); }
      }
    }
    // partitioned cookies
    if (tmpl.partitionKey) {
      for (const d of tmpl.cookieDomains) {
        try {
          const cookies = await chrome.cookies.getAll({ domain: d, partitionKey: tmpl.partitionKey });
          for (const c of cookies) {
            const key = `${c.name}@${c.domain}@${c.path}`;
            if (!seen.has(key)) { seen.add(key); allCookies.push(c); }
          }
        } catch (e) {}
      }
    }

    cookieStr = allCookies.map((c) => `${c.name}=${c.value}`).join("; ");

    if (tmpl.csrfCookieName) {
      const csrfCookie = allCookies.find((c) => c.name === tmpl.csrfCookieName);
      if (!csrfCookie) {
        throw new Error(`csrfToken not found. Cookies: ${allCookies.map(c=>c.name).join(",")}`);
      }
      csrfToken = csrfCookie.value;
    }

    if (tmpl.extraHeadersFromCookie) {
      for (const extra of tmpl.extraHeadersFromCookie) {
        const c = allCookies.find((ck) => ck.name === extra.cookieName);
        if (c) extraHeaders[extra.headerName] = c.value;
      }
    }

    // 如果需要 tokenEndpoint（如 ChatGPT），先获取 accessToken
    if (tmpl.tokenEndpoint) {
      const tokenResp = await fetchWithDnrCookie(
        tmpl.tokenEndpoint,
        cookieStr,
        { headers: { accept: "*/*" } }
      );
      if (!tokenResp.ok) {
        throw new Error(`Token endpoint HTTP ${tokenResp.status}`);
      }
      const tokenData = await tokenResp.json();
      authToken = tokenData[tmpl.tokenField] || "";
      if (!authToken) {
        throw new Error(`Cannot get accessToken from ${tmpl.tokenEndpoint}, possibly not logged in`);
      }
    }
  }

  // 构建请求头
  const headers = { ...tmpl.headers };
  if (csrfToken) headers["x-csrf-token"] = csrfToken;
  for (const [k, v] of Object.entries(extraHeaders)) {
    headers[k] = v;
  }
  // 注入通过 tokenEndpoint 获取的 token
  if (authToken) {
    headers[tmpl.tokenHeader] = tmpl.tokenPrefix + authToken;
  }

  const fetchOpts = { method: tmpl.method, headers };
  if (tmpl.body) fetchOpts.body = JSON.stringify(tmpl.body);

  const resp = await fetchWithDnrCookie(tmpl.url, cookieStr, fetchOpts);
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${bodyText.substring(0, 200)}`);
  }
  const result = await resp.json();

  // chatgpt-codex: 额外获取 codex-reset.com 重置预测（公开 API，无需鉴权）
  if (inst.type === "chatgpt-codex") {
    try {
      const forecastResp = await fetchWithTimeout(
        "https://codex-reset.com/api/forecast?tz=Asia%2FShanghai&locale=zh",
        { headers: { accept: "application/json", referer: "https://codex-reset.com/zh/" } },
        FORECAST_TIMEOUT_MS
      );
      if (forecastResp.ok) {
        result._resetForecast = await forecastResp.json();
      }
    } catch (e) {
      console.log("[QuotaWatcher] forecast fetch failed:", e.message);
    }
  }

  // minimax: 额外获取 consumption_records 查询套餐名
  if (inst.type === "minimax") {
    try {
      let secUrl, secCookieStr, secHeaders;

      if (inst.authMode === "manual" && inst.manualCurl2) {
        const parsed2 = parseCurl(inst.manualCurl2);
        secUrl = parsed2.url;
        secCookieStr = parsed2.cookieStr;
        secHeaders = { ...tmpl.headers };
        if (parsed2.headers["x-group-id"]) {
          secHeaders["x-group-id"] = parsed2.headers["x-group-id"];
        }
      } else {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
        secUrl = `https://www.minimaxi.com/backend/account/consumption_records?page_num=0&page_size=1&start_time_ms=${monthStart}&end_time_ms=${monthEnd}`;
        secCookieStr = cookieStr;
        secHeaders = headers;
      }

      const secResp = await fetchWithDnrCookie(secUrl, secCookieStr, {
        method: "GET",
        headers: secHeaders,
      });
      if (secResp.ok) {
        const secData = await secResp.json();
        if (secData.records && secData.records.length > 0) {
          result._planName = secData.records[0].item_name;
        }
      }
    } catch (e) {
      console.log("[QuotaWatcher] consumption_records fetch failed:", e.message);
    }
  }

  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "refresh") {
    refreshAll().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === "refreshOne") {
    refreshOne(msg.instanceId).then(() => sendResponse({ ok: true }));
    return true;
  }
  // 测试连接：用传入的 instance（含用户最新编辑）真实请求一次，
  // 不写 storage（不污染缓存），只返回成功或结构化诊断结果。
  if (msg.action === "testConnection") {
    const inst = msg.instance;
    if (!inst || !inst.id) {
      sendResponse({ ok: false, diag: diagnoseError("Unknown source type: (empty)", { authMode: inst && inst.authMode }) });
      return false;
    }
    serializeFetch(() => fetchInstance(inst))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        const diag = diagnoseError(err, {
          type: inst.type,
          authMode: inst.authMode,
          urls: collectUrlsForType(inst.type),
        });
        sendResponse({ ok: false, diag });
      });
    return true;
  }
});

// 从 curl 命令中提取 URL、headers、cookie、body
function parseCurl(curlStr) {
  const result = {
    url: "",
    cookieStr: "",
    headers: {},
    body: undefined,
  };

  // 提取 URL（第一个引号中的内容）
  const urlMatch = curlStr.match(/curl\s+['"]([^'"]+)['"]/);
  if (urlMatch) result.url = urlMatch[1];

  // 提取 -H headers
  const headerMatches = curlStr.matchAll(/-H\s+['"]([^'"]+)['"]/g);
  for (const m of headerMatches) {
    const headerStr = m[1];
    const colonIdx = headerStr.indexOf(":");
    if (colonIdx === -1) continue;
    const key = headerStr.substring(0, colonIdx).trim().toLowerCase();
    const value = headerStr.substring(colonIdx + 1).trim();
    result.headers[key] = value;

    if (key === "cookie") {
      result.cookieStr = value;
    }
  }

  // 提取 -b cookie（备选）
  if (!result.cookieStr) {
    const bMatch = curlStr.match(/-b\s+['"]([^'"]+)['"]/);
    if (bMatch) result.cookieStr = bMatch[1];
  }

  // 提取 --data-raw / --data / -d
  const dataMatch = curlStr.match(/(?:--data-raw|--data|-d)\s+['"]([^'"]*)['"]/);
  if (dataMatch) {
    try {
      result.body = JSON.parse(dataMatch[1]);
    } catch {
      result.body = dataMatch[1];
    }
  }

  return result;
}
