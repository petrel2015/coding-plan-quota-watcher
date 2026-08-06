// settings.js - 数据源设置页面

// 数据源模板（定义支持的类型）
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
    curlHint: "智谱开放平台 -> 个人中心 -> 额度用量 -> DevTools -> Network -> 找 quota/limit 请求 -> 右键 Copy as cURL",
    curlHintUrl: "https://bigmodel.cn/coding-plan/personal/usage",
  },
};

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
];

document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
  loadDisplaySettings();

  document.getElementById("back-btn").addEventListener("click", () => {
    window.location.href = "dashboard.html";
  });
  document.getElementById("add-btn").addEventListener("click", () => {
    addInstance();
  });
  document.getElementById("cols-select").addEventListener("change", (e) => {
    chrome.storage.local.set({ displayCols: parseInt(e.target.value) });
  });
});

// 从 DOM 收集当前所有卡片值，写入 storage
async function collectCardsToStorage() {
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  const container = document.getElementById("instances");
  const cards = container.querySelectorAll(".instance-card");
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const fields = card.querySelectorAll("[data-field]");
    for (const field of fields) {
      const fieldName = field.dataset.field;
      let value;
      if (field.type === "checkbox") {
        value = field.checked;
      } else if (field.tagName === "SELECT") {
        value = field.value;
      } else if (field.tagName === "TEXTAREA") {
        value = field.value.trim();
      } else {
        value = field.value;
      }
      if (instances[i]) {
        instances[i][fieldName] = value;
      }
    }
  }
  await chrome.storage.local.set({ instances });
  return instances;
}

async function loadDisplaySettings() {
  const result = await chrome.storage.local.get("displayCols");
  const cols = result.displayCols || 2;
  document.getElementById("cols-select").value = cols;
}

async function getInstances() {
  const result = await chrome.storage.local.get("instances");
  if (!result.instances) {
    await chrome.storage.local.set({ instances: DEFAULT_INSTANCES });
    return DEFAULT_INSTANCES;
  }
  // 迁移旧字段 manualCookie -> manualCurl
  let changed = false;
  for (const inst of result.instances) {
    if (inst.manualCookie && !inst.manualCurl) {
      inst.manualCurl = inst.manualCookie;
      delete inst.manualCookie;
      changed = true;
    }
  }
  if (changed) {
    await chrome.storage.local.set({ instances: result.instances });
  }
  return result.instances;
}

async function loadAndRender() {
  const instances = await getInstances();
  const container = document.getElementById("instances");
  container.innerHTML = "";
  for (const inst of instances) {
    container.appendChild(renderInstanceCard(inst, instances.indexOf(inst)));
  }
}

function renderInstanceCard(inst, index) {
  const card = document.createElement("div");
  card.className = "instance-card" + (inst.enabled ? "" : " disabled");

  const template = SOURCE_TEMPLATES[inst.type];

  card.innerHTML = `
    <div class="instance-row">
      <label class="toggle">
        <input type="checkbox" ${inst.enabled ? "checked" : ""} data-index="${index}" data-field="enabled">
        <span class="toggle-slider"></span>
      </label>
      <input class="field-input instance-name-input" type="text" value="${inst.name}" data-index="${index}" data-field="name" style="flex:1;font-weight:600;">
      <span class="instance-type">${template ? template.name : inst.type}</span>
      <button class="instance-move instance-move-up" data-index="${index}" data-dir="up" title="上移">↑</button>
      <button class="instance-move instance-move-down" data-index="${index}" data-dir="down" title="下移">↓</button>
      <button class="instance-delete" data-index="${index}">删除</button>
    </div>
    <div class="field-row">
      <span class="field-label">类型</span>
      <select class="field-input" data-index="${index}" data-field="type">
        ${Object.entries(SOURCE_TEMPLATES).map(([key, tmpl]) =>
          `<option value="${key}" ${inst.type === key ? "selected" : ""}>${tmpl.name}</option>`
        ).join("")}
      </select>
    </div>
    <div class="field-row">
      <span class="field-label">鉴权</span>
      <select class="field-input" data-index="${index}" data-field="authMode">
        <option value="local" ${inst.authMode === "local" ? "selected" : ""}>本地 Cookie（自动）</option>
        <option value="manual" ${inst.authMode === "manual" ? "selected" : ""}>手动粘贴 Cookie</option>
      </select>
    </div>
    <div class="manual-cookie-row" style="display:${inst.authMode === "manual" ? "block" : "none"}">
      <div class="field-row">
        <span class="field-label">curl</span>
      </div>
      <textarea class="cookie-textarea" data-index="${index}" data-field="manualCurl" placeholder="${template ? (template.curlHint || '粘贴完整 curl 命令') : '粘贴完整 curl 命令'}">${inst.manualCurl || inst.manualCookie || ""}</textarea>
      <div class="cookie-hint">${template ? template.curlHint || '从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里' : '从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里'}</div>
      <div class="manual-cookie2-row" style="display:${inst.type === "minimax" && inst.authMode === "manual" ? "block" : "none"}">
        <div class="field-row">
          <span class="field-label">curl2 (套餐名)</span>
        </div>
        <textarea class="cookie-textarea" data-index="${index}" data-field="manualCurl2" placeholder="${template && template.curl2Hint ? template.curl2Hint : '可选，粘贴第二个 curl 命令'}">${inst.manualCurl2 || ""}</textarea>
        <div class="cookie-hint">${template && template.curl2Hint ? template.curl2Hint : ''}</div>
      </div>
    </div>
  `;

  // 自动保存：输入框 blur、checkbox/select change 时收集 DOM 写入 storage
  const allFields = card.querySelectorAll("[data-field]");
  for (const field of allFields) {
    if (field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
      field.addEventListener("blur", () => {
        collectCardsToStorage().then(() => showToast("已自动保存"));
      });
    } else {
      field.addEventListener("change", () => {
        collectCardsToStorage().then(() => showToast("已自动保存"));
      });
    }
  }

  // events
  const authSelect = card.querySelector('[data-field="authMode"]');
  const cookieRow = card.querySelector(".manual-cookie-row");

  const typeSelect = card.querySelector('[data-field="type"]');

  function updateCurl2Visibility(type, authMode) {
    const curl2Row = card.querySelector(".manual-cookie2-row");
    if (curl2Row) {
      curl2Row.style.display = (type === "minimax" && authMode === "manual") ? "block" : "none";
    }
  }

  authSelect.addEventListener("change", (e) => {
    cookieRow.style.display = e.target.value === "manual" ? "block" : "none";
    updateCurl2Visibility(inst.type, e.target.value);
    collectCardsToStorage().then(() => showToast("已自动保存"));
  });

  typeSelect.addEventListener("change", (e) => {
    const newType = e.target.value;
    const newTmpl = SOURCE_TEMPLATES[newType];
    const typeBadge = card.querySelector(".instance-type");
    typeBadge.textContent = newTmpl ? newTmpl.name : newType;
    // 更新 curl hint
    const hintDiv = card.querySelector(".cookie-hint");
    const textarea = card.querySelector(".cookie-textarea");
    if (newTmpl) {
      hintDiv.textContent = newTmpl.curlHint || '从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里';
      textarea.placeholder = newTmpl.curlHint || '粘贴完整 curl 命令';
    }
    updateCurl2Visibility(newType, authSelect.value);
    collectCardsToStorage().then(() => showToast("已自动保存"));
  });

  const deleteBtn = card.querySelector(".instance-delete");
  deleteBtn.addEventListener("click", () => {
    if (confirm(`确认删除「${inst.name}」？`)) {
      deleteInstance(index);
    }
  });

  const moveUpBtn = card.querySelector(".instance-move-up");
  moveUpBtn.addEventListener("click", () => moveInstance(index, -1));
  const moveDownBtn = card.querySelector(".instance-move-down");
  moveDownBtn.addEventListener("click", () => moveInstance(index, 1));

  return card;
}

async function moveInstance(index, dir) {
  const instances = await collectCardsToStorage();
  const newIndex = index + dir;
  if (newIndex < 0 || newIndex >= instances.length) return;
  const tmp = instances[index];
  instances[index] = instances[newIndex];
  instances[newIndex] = tmp;
  await chrome.storage.local.set({ instances });
  loadAndRender();
}

async function addInstance() {
  await collectCardsToStorage();
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  // 默认加火山方舟
  const count = instances.filter((i) => i.type === "volcengine-ark").length + 1;
  instances.push({
    id: `${Date.now()}`,
    name: `火山方舟 #${count}`,
    type: "volcengine-ark",
    enabled: true,
    authMode: "manual",
    manualCurl: "",
  });
  await chrome.storage.local.set({ instances });
  loadAndRender();
}

async function deleteInstance(index) {
  await collectCardsToStorage();
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  instances.splice(index, 1);
  await chrome.storage.local.set({ instances });
  loadAndRender();
}

function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}
