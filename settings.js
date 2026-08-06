// settings.js - 数据源设置页面
// SOURCE_TEMPLATES / DEFAULT_INSTANCES 由 sources.js 提供（HTML 中先加载）

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
