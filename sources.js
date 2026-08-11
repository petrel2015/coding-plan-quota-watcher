// sources.js - 数据源模板与默认配置（单一来源）
// 被 background.js（importScripts）、settings.js（<script>）、common.js（间接）共用
// 末尾 UMD 导出：浏览器经典脚本挂全局 + node/vitest 通过 require 引用

const SOURCE_TEMPLATES = {
  "volcengine-ark": {
    name: "火山方舟 Agent Plan",
    type: "volcengine-ark",
    url: "https://console.volcengine.com/api/top/ark/cn-beijing/2024-01-01/GetAgentPlanAFPUsage?",
    method: "POST",
    body: {},
    cookieDomains: ["console.volcengine.com", "volcengine.com", "signin.volcengine.com"],
    partitionKey: { topLevelSite: "https://console.volcengine.com" },
    csrfCookieName: "csrfToken",
    headers: {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "origin": "https://console.volcengine.com",
      "referer": "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
    },
    loginUrl: "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
    curlHint: "DevTools -> Network -> 找 GetAgentPlanAFPUsage 请求 -> 右键 Copy as cURL",
    curlHintUrl: "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
  },
  "minimax": {
    name: "MiniMax Token Plan",
    type: "minimax",
    url: "https://www.minimaxi.com/backend/account/token_plan/remains_percent",
    method: "GET",
    body: null,
    cookieDomains: ["minimaxi.com", "www.minimaxi.com", "platform.minimaxi.com"],
    csrfCookieName: null,
    extraHeadersFromCookie: [
      { cookieName: "minimax_group_id_v2", headerName: "x-group-id" },
    ],
    headers: {
      "accept": "application/json, text/plain, */*",
      "origin": "https://platform.minimaxi.com",
      "referer": "https://platform.minimaxi.com/",
    },
    loginUrl: "https://platform.minimaxi.com/login",
    curlHint: "DevTools -> Network -> 找 remains_percent 请求 -> 右键 Copy as cURL",
    curlHintUrl: "https://platform.minimaxi.com/",
    curl2Hint: "DevTools -> Network -> 找 consumption_records 请求 -> 右键 Copy as cURL（用于获取套餐名，可选）",
  },
  "chatgpt-codex": {
    name: "ChatGPT Codex 用量",
    type: "chatgpt-codex",
    url: "https://chatgpt.com/backend-api/wham/usage",
    method: "GET",
    body: null,
    cookieDomains: ["chatgpt.com", ".chatgpt.com"],
    partitionKey: { topLevelSite: "https://chatgpt.com" },
    csrfCookieName: null,
    tokenEndpoint: "https://chatgpt.com/api/auth/session",
    tokenField: "accessToken",
    tokenHeader: "authorization",
    tokenPrefix: "Bearer ",
    extraHeadersFromCookie: [
      { cookieName: "oai-did", headerName: "oai-device-id" },
    ],
    preserveHeaders: [
      "authorization",
      "oai-device-id",
      "oai-client-version",
      "oai-client-build-number",
      "oai-language",
      "oai-session-id",
    ],
    headers: {
      "accept": "*/*",
      "referer": "https://chatgpt.com/",
    },
    loginUrl: "https://chatgpt.com/auth/login",
    curlHint: "ChatGPT 设置页 Usage (Settings/Usage) -> DevTools -> Network -> 找 wham/usage 请求 -> 右键 Copy as cURL",
    curlHintUrl: "https://chatgpt.com/#settings/Usage",
  },
  "zhipu-glm": {
    name: "智谱 GLM 用量",
    type: "zhipu-glm",
    url: "https://bigmodel.cn/api/monitor/usage/quota/limit?type=1",
    method: "GET",
    body: null,
    cookieDomains: ["bigmodel.cn", ".bigmodel.cn"],
    csrfCookieName: null,
    extraHeadersFromCookie: [
      { cookieName: "bigmodel_token_production", headerName: "authorization" },
    ],
    preserveHeaders: [
      "authorization",
      "bigmodel-organization",
      "bigmodel-project",
    ],
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "zh",
      "referer": "https://bigmodel.cn/coding-plan/personal/usage",
      "set-language": "zh",
    },
    loginUrl: "https://bigmodel.cn/coding-plan/personal/usage",
    curlHint: "智谱开放平台 -> 个人中心 -> 额度用量 -> DevTools -> Network -> 找 quota/limit 请求 -> 右键 Copy as cURL",
    curlHintUrl: "https://bigmodel.cn/coding-plan/personal/usage",
  },
};

// 类型顺序（settings 下拉 / 默认配置用）
const SOURCE_ORDER = ["volcengine-ark", "minimax", "chatgpt-codex", "zhipu-glm"];

// 默认配置（首次安装时写入）
const DEFAULT_INSTANCES = [
  {
    id: "volcengine-ark-1",
    name: "火山方舟 #1",
    type: "volcengine-ark",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
  {
    id: "minimax-1",
    name: "MiniMax #1",
    type: "minimax",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
  {
    id: "zhipu-glm-1",
    name: "智谱 GLM #1",
    type: "zhipu-glm",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
];

// 迁移旧字段 manualCookie → manualCurl（纯函数，可被测试）
// 返回 { instances, changed }；不修改入参，返回新数组
function migrateInstances(inputInstances) {
  const instances = (inputInstances || []).map((inst) => ({ ...inst }));
  let changed = false;
  for (const inst of instances) {
    if (inst.manualCookie && !inst.manualCurl) {
      inst.manualCurl = inst.manualCookie;
      delete inst.manualCookie;
      changed = true;
    }
  }
  return { instances, changed };
}

// UMD 导出：node/vitest 用 require，浏览器经典脚本挂全局
if (typeof module !== "undefined" && module.exports) {
  module.exports = { SOURCE_TEMPLATES, SOURCE_ORDER, DEFAULT_INSTANCES, migrateInstances };
}
if (typeof globalThis !== "undefined") {
  globalThis.SOURCE_TEMPLATES = SOURCE_TEMPLATES;
  globalThis.SOURCE_ORDER = SOURCE_ORDER;
  globalThis.DEFAULT_INSTANCES = DEFAULT_INSTANCES;
  globalThis.migrateInstances = migrateInstances;
}
