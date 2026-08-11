// settings.js - 数据源设置页面
// SOURCE_TEMPLATES / DEFAULT_INSTANCES 由 sources.js 提供（HTML 中先加载）

document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
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
  document.getElementById("theme-select").addEventListener("change", (e) => {
    const theme = e.target.value;
    chrome.storage.local.set({ theme });
    setThemeAttr(theme);
  });
});

// 从 DOM 收集当前所有卡片值，写入 storage（按 instanceId 匹配，不依赖 DOM 顺序）
async function collectCardsToStorage() {
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  const byId = new Map(instances.map((inst) => [inst.id, inst]));
  const container = document.getElementById("instances");
  const cards = container.querySelectorAll(".instance-card");
  for (const card of cards) {
    const id = card.dataset.instanceId;
    const inst = byId.get(id);
    if (!inst) continue;
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
      inst[fieldName] = value;
    }
  }
  await chrome.storage.local.set({ instances });
  return instances;
}

async function loadDisplaySettings() {
  const result = await chrome.storage.local.get("displayCols");
  const cols = result.displayCols || 2;
  document.getElementById("cols-select").value = cols;

  const { theme } = await chrome.storage.local.get("theme");
  document.getElementById("theme-select").value = theme || "auto";
}

async function getInstances() {
  const result = await chrome.storage.local.get("instances");
  if (!result.instances) {
    await chrome.storage.local.set({ instances: DEFAULT_INSTANCES });
    return DEFAULT_INSTANCES;
  }
  // 复用 sources.js 的迁移逻辑（单一来源）
  const { instances, changed } = migrateInstances(result.instances);
  if (changed) {
    await chrome.storage.local.set({ instances });
  }
  return instances;
}

async function loadAndRender() {
  const instances = await getInstances();
  const container = document.getElementById("instances");
  container.innerHTML = "";
  for (const inst of instances) {
    container.appendChild(renderInstanceCard(inst, instances));
  }
}

// 检测本地 cookie 模式下的登录态，渲染到 card 的 .login-status-content
async function checkLoginStatus(type, card) {
  const content = card.querySelector(".login-status-content");
  if (!content) return;
  const tmpl = SOURCE_TEMPLATES[type];
  if (!tmpl || !tmpl.cookieDomains) {
    content.innerHTML = `<span class="login-status-text login-unknown">未知数据源</span>`;
    return;
  }

  content.innerHTML = `<span class="login-status-text login-checking">检测中...</span>`;

  try {
    // 统计各域名下的 cookie 数（去重）
    let total = 0;
    const seen = new Set();
    for (const d of tmpl.cookieDomains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain: d });
        for (const c of cookies) {
          const key = `${c.name}@${c.domain}@${c.path}`;
          if (!seen.has(key)) { seen.add(key); total++; }
        }
      } catch (e) {}
    }

    if (total > 0) {
      content.innerHTML = `<span class="login-status-text login-ok">✓ 已检测到登录信息（${total} 条 Cookie）</span>`;
    } else {
      const loginUrl = escapeHtml(tmpl.loginUrl || "#");
      content.innerHTML = `
        <span class="login-status-text login-miss">未检测到登录信息</span>
        <button class="login-now-btn" data-login-url="${loginUrl}">立即登录</button>
      `;
      const btn = content.querySelector(".login-now-btn");
      if (btn) {
        btn.addEventListener("click", () => {
          const url = btn.dataset.loginUrl;
          if (url && url !== "#") chrome.tabs.create({ url });
        });
      }
    }
  } catch (e) {
    content.innerHTML = `<span class="login-status-text login-unknown">检测失败：${escapeHtml(e.message)}</span>`;
  }
}

function renderInstanceCard(inst, allInstances = []) {
  const card = document.createElement("div");
  card.className = "instance-card" + (inst.enabled ? "" : " disabled");
  card.dataset.instanceId = inst.id;

  const template = SOURCE_TEMPLATES[inst.type];

  // 同一 type 下，浏览器 cookie 按域名共享，多个实例读到的凭证相同会显示重复数据。
  // 因此同 type 只允许一个 local 实例。规则：按数组顺序，第一个 local 占用槽位；
  // 排在它后面的同 type 实例（无论配置写的是 local 还是 manual）都不能选 local。
  const myIdx = allInstances.findIndex((x) => x.id === inst.id);
  const localSlotTakenBefore = myIdx >= 0 && allInstances.some(
    (o, idx) => idx < myIdx && o.type === inst.type && o.authMode === "local"
  );
  // 锁定：前面已有同 type 的 local 占用槽位，本实例不能用 local
  const localLocked = localSlotTakenBefore;
  // 若被锁定，强制按 manual 渲染（即使配置写的是 local）
  const effectiveAuthMode = localLocked ? "manual" : inst.authMode;

  card.innerHTML = `
    <div class="instance-row">
      <label class="toggle">
        <input type="checkbox" ${inst.enabled ? "checked" : ""} data-field="enabled">
        <span class="toggle-slider"></span>
      </label>
      <input class="field-input instance-name-input" type="text" value="${inst.name}" data-field="name" style="flex:1;font-weight:600;">
      <button class="instance-move instance-move-up" data-dir="up" title="上移">↑</button>
      <button class="instance-move instance-move-down" data-dir="down" title="下移">↓</button>
      <button class="instance-delete">删除</button>
    </div>
    <div class="field-row">
      <span class="field-label">类型</span>
      <select class="field-input" data-field="type">
        ${Object.entries(SOURCE_TEMPLATES).map(([key, tmpl]) =>
          `<option value="${key}" ${inst.type === key ? "selected" : ""}>${tmpl.name}</option>`
        ).join("")}
      </select>
    </div>
    <div class="field-row">
      <span class="field-label">鉴权</span>
      <select class="field-input" data-field="authMode"${localLocked ? " disabled" : ""}>
        <option value="local" ${effectiveAuthMode === "local" ? "selected" : ""}${localLocked ? " disabled" : ""}>本地 Cookie（自动）</option>
        <option value="manual" ${effectiveAuthMode === "manual" ? "selected" : ""}>手动粘贴 Cookie</option>
      </select>
    </div>
    ${localLocked ? `<div class="auth-locked-hint">同一平台已有数据源占用浏览器自动获取，本卡只能手动粘贴</div>` : ""}
    <div class="login-status-row field-row" style="display:${effectiveAuthMode === "local" ? "flex" : "none"}">
      <span class="field-label">状态</span>
      <div class="login-status-content"><span class="login-status-text">检测中...</span></div>
    </div>
    <div class="manual-cookie-row" style="display:${effectiveAuthMode === "manual" ? "block" : "none"}">
      <div class="field-row">
        <span class="field-label">curl</span>
      </div>
      <textarea class="cookie-textarea" data-field="manualCurl" placeholder="${template ? (template.curlHint || '粘贴完整 curl 命令') : '粘贴完整 curl 命令'}">${inst.manualCurl || inst.manualCookie || ""}</textarea>
      <div class="cookie-hint">${template ? template.curlHint || '从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里' : '从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里'}</div>
      <div class="manual-cookie2-row" style="display:${inst.type === "minimax" && inst.authMode === "manual" ? "block" : "none"}">
        <div class="field-row">
          <span class="field-label">curl2 (套餐名)</span>
        </div>
        <textarea class="cookie-textarea" data-field="manualCurl2" placeholder="${template && template.curl2Hint ? template.curl2Hint : '可选，粘贴第二个 curl 命令'}">${inst.manualCurl2 || ""}</textarea>
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
  const loginStatusRow = card.querySelector(".login-status-row");

  const typeSelect = card.querySelector('[data-field="type"]');

  function updateCurl2Visibility(type, authMode) {
    const curl2Row = card.querySelector(".manual-cookie2-row");
    if (curl2Row) {
      curl2Row.style.display = (type === "minimax" && authMode === "manual") ? "block" : "none";
    }
  }

  authSelect.addEventListener("change", (e) => {
    const isLocal = e.target.value === "local";
    cookieRow.style.display = isLocal ? "none" : "block";
    loginStatusRow.style.display = isLocal ? "flex" : "none";
    if (isLocal) checkLoginStatus(typeSelect.value, card);
    updateCurl2Visibility(typeSelect.value, e.target.value);
    // 切换鉴权模式会影响同 type 下其他卡片的 local 锁定态，整体重渲
    collectCardsToStorage().then(() => {
      loadAndRender();
      showToast("已自动保存");
    });
  });

  typeSelect.addEventListener("change", (e) => {
    const newType = e.target.value;
    // 先把当前 DOM 收集进 storage，再整体重渲——
    // 切换类型会影响同 type 下其他卡片的 local 锁定态，必须重渲全部
    collectCardsToStorage().then(() => {
      loadAndRender();
      showToast("已自动保存");
    });
  });

  // 本地模式首次渲染时检测登录态
  if (inst.authMode === "local") checkLoginStatus(inst.type, card);

  const deleteBtn = card.querySelector(".instance-delete");
  deleteBtn.addEventListener("click", () => {
    if (confirm(`确认删除「${inst.name}」？`)) {
      deleteInstance(inst.id);
    }
  });

  const moveUpBtn = card.querySelector(".instance-move-up");
  moveUpBtn.addEventListener("click", () => moveInstance(inst.id, -1));
  const moveDownBtn = card.querySelector(".instance-move-down");
  moveDownBtn.addEventListener("click", () => moveInstance(inst.id, 1));

  return card;
}

async function moveInstance(instanceId, dir) {
  const instances = await collectCardsToStorage();
  const index = instances.findIndex((i) => i.id === instanceId);
  if (index === -1) return;
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
  // 默认名字 "coding plan"，已存在则递增 "coding plan #2"/"#3"...
  const baseName = "coding plan";
  const dupCount = instances.filter(
    (i) => i.name === baseName || i.name.startsWith(baseName + " #")
  ).length;
  const name = dupCount === 0 ? baseName : `${baseName} #${dupCount + 1}`;
  instances.push({
    id: `${Date.now()}`,
    name,
    type: "volcengine-ark",
    enabled: true,
    authMode: "manual",
    manualCurl: "",
  });
  await chrome.storage.local.set({ instances });
  loadAndRender();
}

async function deleteInstance(instanceId) {
  await collectCardsToStorage();
  const result = await chrome.storage.local.get("instances");
  const instances = result.instances || [];
  const index = instances.findIndex((i) => i.id === instanceId);
  if (index === -1) return;
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
