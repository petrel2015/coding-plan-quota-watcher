// background.js - Service Worker
// 从 storage 读取实例配置，动态拉取数据，缓存到 storage
// 数据源模板从 sources.js 引入（单一来源，与 settings.js 共用）

importScripts("sources.js");

const ALARM_NAME = "quota-refresh";
const REFRESH_INTERVAL_MINUTES = 5;

chrome.runtime.onInstalled.addListener(async () => {
  console.log("[QuotaWatcher v1.6.5] installed");
  // 清理所有残留 DNR 规则
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (existingRules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRules.map((r) => r.id),
    });
    console.log(`[QuotaWatcher] cleaned ${existingRules.length} stale DNR rules`);
  }
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

async function getInstances() {
  const result = await chrome.storage.local.get("instances");
  if (!result.instances) return [];
  return result.instances.filter((i) => i.enabled);
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
    // 逐个串行刷新，每个都走 serializeFetch 确保不并发
    for (const inst of instances) {
      await serializeFetch(() => fetchAndStore(inst));
    }
  } finally {
    _refreshing = false;
  }
}

// 刷新单个实例（卡片调用）
async function refreshOne(instanceId) {
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  const inst = instances.find((i) => i.id === instanceId && i.enabled);
  if (!inst) return;
  await serializeFetch(() => fetchAndStore(inst));
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
        _hasValidData: true,
        _name: inst.name,
        _type: inst.type,
      },
    });
    console.log(`[QuotaWatcher] ${inst.id} OK`);
  } catch (err) {
    console.error(`[QuotaWatcher] ${inst.id} error:`, err);
    const existing = await chrome.storage.local.get(`data_${inst.id}`);
    const oldData = existing[`data_${inst.id}`];
    if (oldData && oldData._hasValidData) {
      await chrome.storage.local.set({
        [`data_${inst.id}`]: {
          ...oldData,
          _lastError: err.message,
        },
      });
      console.log(`[QuotaWatcher] ${inst.id} fetch failed, keeping last data`);
    } else {
      await chrome.storage.local.set({
        [`data_${inst.id}`]: {
          _fetchedAt: Date.now(),
          _error: err.message,
          _lastError: null,
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
  if (!tmpl) throw new Error(`未知数据源类型: ${inst.type}`);

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
        throw new Error(`curl 中未找到 ${tmpl.csrfCookieName} 或 X-Csrf-Token`);
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
      const tokenUrlObj = new URL(tmpl.tokenEndpoint);
      const tokenQwid = inst.id + "_" + Date.now() + "_t";
      const tokenBustUrl = new URL(tmpl.tokenEndpoint);
      tokenBustUrl.searchParams.set("_qwid", tokenQwid);
      const tokenRuleId = 3;

      // 清除残留规则
      const tokenAllRules = await chrome.declarativeNetRequest.getDynamicRules();
      if (tokenAllRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: tokenAllRules.map((r) => r.id),
        });
      }

      const tokenDnrRule = {
        id: tokenRuleId,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "cookie", operation: "set", value: cookieStr },
          ],
        },
        condition: {
          urlFilter: `_qwid=${tokenQwid}`,
          resourceTypes: ["xmlhttprequest", "other"],
        },
      };

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [tokenRuleId],
        addRules: [tokenDnrRule],
      });

      try {
        const tokenResp = await fetch(tokenBustUrl.toString(), {
          headers: { "accept": "*/*" },
          cache: "no-store",
        });
        if (!tokenResp.ok) {
          throw new Error(`Token 接口 HTTP ${tokenResp.status}`);
        }
        const tokenData = await tokenResp.json();
        authToken = tokenData[tmpl.tokenField] || "";
        if (!authToken) {
          throw new Error(`无法从 ${tmpl.tokenEndpoint} 获取 accessToken，可能未登录`);
        }
      } finally {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [tokenRuleId],
        });
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

  // DNR 注入 Cookie header
  // 先清除所有残留动态规则，确保只有当前规则生效
  const allRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (allRules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: allRules.map((r) => r.id),
    });
  }

  const urlObj = new URL(tmpl.url);
  const qwid = inst.id + "_" + Date.now();
  const bustUrl = new URL(tmpl.url);
  bustUrl.searchParams.set("_qwid", qwid);

  const ruleId = 1;

  const dnrRule = {
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
  };

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [dnrRule],
  });

  const fetchOpts = { method: tmpl.method, headers, cache: "no-store" };
  if (tmpl.body) fetchOpts.body = JSON.stringify(tmpl.body);

  try {
    const resp = await fetch(bustUrl.toString(), fetchOpts);
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${bodyText.substring(0, 200)}`);
    }
    const result = await resp.json();

    // chatgpt-codex: 额外获取 codex-reset.com 重置预测（公开 API，无需鉴权）
    if (inst.type === "chatgpt-codex") {
      try {
        const forecastResp = await fetch(
          "https://codex-reset.com/api/forecast?tz=Asia%2FShanghai&locale=zh",
          { headers: { "accept": "application/json", "referer": "https://codex-reset.com/zh/" } }
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

        const secUrlObj = new URL(secUrl);
        const secQwid = inst.id + "_" + Date.now() + "_s";
        const secBustUrl = new URL(secUrl);
        secBustUrl.searchParams.set("_qwid", secQwid);
        const secRuleId = 2;

        // 清除残留规则后注册
        const secAllRules = await chrome.declarativeNetRequest.getDynamicRules();
        if (secAllRules.length > 0) {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: secAllRules.map((r) => r.id),
          });
        }

        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [secRuleId],
          addRules: [{
            id: secRuleId,
            priority: 1,
            action: {
              type: "modifyHeaders",
              requestHeaders: [
                { header: "cookie", operation: "set", value: secCookieStr },
              ],
            },
            condition: {
              urlFilter: `_qwid=${secQwid}`,
              resourceTypes: ["xmlhttprequest", "other"],
            },
          }],
        });

        try {
          const secResp = await fetch(secBustUrl.toString(), { method: "GET", headers: secHeaders, cache: "no-store" });
          if (secResp.ok) {
            const secData = await secResp.json();
            if (secData.records && secData.records.length > 0) {
              result._planName = secData.records[0].item_name;
            }
          }
        } finally {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [secRuleId],
          });
        }
      } catch (e) {
        console.log("[QuotaWatcher] consumption_records fetch failed:", e.message);
      }
    }

    return result;
  } finally {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ruleId],
    });
  }
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
