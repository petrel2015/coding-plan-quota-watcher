// ES module 版数据源模板，供 Vue 组件 / background import
// name / curlHint / curl2Hint 字段存的是 i18n key，调用方用 t() 翻译
// （background 不用这些展示字段，故不受影响）

import { t } from "./i18n.js";

export const SOURCE_TEMPLATES = {
  "volcengine-ark": {
    name: "source.volcengine.name",
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
    curlHint: "source.volcengine.curlHint",
    curlHintUrl: "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan",
  },
  "minimax": {
    name: "source.minimax.name",
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
    curlHint: "source.minimax.curlHint",
    curlHintUrl: "https://platform.minimaxi.com/",
    curl2Hint: "source.minimax.curl2Hint",
  },
  "chatgpt-codex": {
    name: "source.chatgpt.name",
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
    curlHint: "source.chatgpt.curlHint",
    curlHintUrl: "https://chatgpt.com/#settings/Usage",
  },
  "zhipu-glm": {
    name: "source.zhipu.name",
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
    curlHint: "source.zhipu.curlHint",
    curlHintUrl: "https://bigmodel.cn/coding-plan/personal/usage",
  },
};

// 类型顺序（settings 下拉 / 默认配置用）
export const SOURCE_ORDER = ["volcengine-ark", "minimax", "chatgpt-codex", "zhipu-glm"];

// 数据源展示名（翻译 name key）；未知类型回退到 "coding plan"
export function getSourceName(type) {
  const tmpl = SOURCE_TEMPLATES[type];
  return (tmpl && t(tmpl.name)) || "coding plan";
}

// 默认配置（首次安装时写入，按当前浏览器语言生成默认名）
export const DEFAULT_INSTANCES = [
  {
    id: "volcengine-ark-1",
    name: `${t("source.volcengine.defaultName")} #1`,
    type: "volcengine-ark",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
  {
    id: "minimax-1",
    name: `${t("source.minimax.defaultName")} #1`,
    type: "minimax",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
  {
    id: "zhipu-glm-1",
    name: `${t("source.zhipu.defaultName")} #1`,
    type: "zhipu-glm",
    enabled: true,
    authMode: "local",
    manualCurl: "",
  },
];

// 迁移旧字段 manualCookie → manualCurl（纯函数，可被测试）
// 返回 { instances, changed }；不修改入参，返回新数组
export function migrateInstances(inputInstances) {
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

// 生成某个类型的新数据源默认名字：取该类型模板的 name 作 base，
// 与现有同名实例去重："MiniMax Token Plan" → "MiniMax Token Plan #2" → "#3"...
// excludeId 用于「类型变更时重命名」场景：重算时不把自己算进重复计数。
export function generateInstanceName(type, existingInstances, excludeId) {
  const baseName = getSourceName(type);
  const list = (existingInstances || []).filter(
    (i) => i.id !== excludeId && (i.name === baseName || (i.name && i.name.startsWith(baseName + " #")))
  );
  return list.length === 0 ? baseName : `${baseName} #${list.length + 1}`;
}
