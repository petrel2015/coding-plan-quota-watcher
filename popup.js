// popup.js - 弹窗逻辑
// 每个卡片独立刷新，互不干扰

const AUTO_REFRESH_SEC = 10;
const cardTimers = {};

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  document.getElementById("dashboard-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  document.getElementById("refresh-all-btn").addEventListener("click", () => {
    refreshAllCards();
  });
});

async function renderAll() {
  const container = document.getElementById("sources");
  container.innerHTML = "";

  const keys = await chrome.storage.local.get(null);
  const instances = keys.instances || [];
  const enabled = instances.filter((i) => i.enabled);

  if (enabled.length === 0) {
    container.innerHTML = '<div class="empty">暂无数据源，请到设置页面添加</div>';
    return;
  }

  for (const inst of enabled) {
    const data = keys[`data_${inst.id}`];
    const card = renderSource(inst, data);
    container.appendChild(card);
    startCardTimer(inst.id);
  }
}

function startCardTimer(instanceId) {
  if (cardTimers[instanceId]?.timer) {
    clearInterval(cardTimers[instanceId].timer);
  }
  cardTimers[instanceId] = { countdown: AUTO_REFRESH_SEC, refreshing: false };
  updateCardTimerDisplay(instanceId);

  cardTimers[instanceId].timer = setInterval(() => {
    cardTimers[instanceId].countdown--;
    if (cardTimers[instanceId].countdown <= 0) {
      refreshCard(instanceId);
    } else {
      updateCardTimerDisplay(instanceId);
    }
  }, 1000);
}

function updateCardTimerDisplay(instanceId) {
  const el = document.getElementById(`timer-${instanceId}`);
  if (el) el.textContent = `${cardTimers[instanceId].countdown}s`;
}

async function refreshCard(instanceId) {
  if (cardTimers[instanceId]?.refreshing) return;
  cardTimers[instanceId].refreshing = true;
  const btn = document.getElementById(`refresh-card-${instanceId}`);
  if (btn) { btn.textContent = "刷新中"; btn.disabled = true; }

  await chrome.runtime.sendMessage({ action: "refreshOne", instanceId });

  setTimeout(() => {
    updateCard(instanceId);
    if (btn) { btn.textContent = "刷新"; btn.disabled = false; }
    cardTimers[instanceId].refreshing = false;
    cardTimers[instanceId].countdown = AUTO_REFRESH_SEC;
    updateCardTimerDisplay(instanceId);
  }, 500);
}

async function refreshAllCards() {
  const keys = await chrome.storage.local.get("instances");
  const instances = (keys.instances || []).filter((i) => i.enabled);
  for (const inst of instances) {
    refreshCard(inst.id);
  }
}

async function updateCard(instanceId) {
  const keys = await chrome.storage.local.get(["instances", `data_${instanceId}`]);
  const instances = keys.instances || [];
  const inst = instances.find((i) => i.id === instanceId);
  if (!inst) return;
  const data = keys[`data_${instanceId}`];

  const oldCard = document.getElementById(`card-${instanceId}`);
  if (oldCard) {
    const newCard = renderSource(inst, data);
    oldCard.replaceWith(newCard);
  }
}

function renderSource(inst, data) {
  const card = document.createElement("div");
  card.className = "source-card";
  card.id = `card-${inst.id}`;

  const header = document.createElement("div");
  header.className = "source-header";
  header.innerHTML = `
    <span class="source-name">${inst.name}</span>
    <div class="card-controls">
      <span id="timer-${inst.id}" class="card-timer">${AUTO_REFRESH_SEC}s</span>
      <button id="refresh-card-${inst.id}" class="card-refresh-btn">刷新</button>
    </div>
  `;
  card.appendChild(header);

  setTimeout(() => {
    const btn = card.querySelector(`#refresh-card-${inst.id}`);
    if (btn) {
      btn.addEventListener("click", () => refreshCard(inst.id));
    }
  }, 0);

  if (!data) {
    card.insertAdjacentHTML("beforeend", `<div class="error-msg">暂无数据</div>`);
    return card;
  }

  if (data._lastError) {
    card.insertAdjacentHTML("beforeend", `<div class="fetch-warn">获取失败（${data._lastError}），显示上次数据</div>`);
  }

  if (data._error && !data._hasValidData) {
    card.insertAdjacentHTML("beforeend", `<div class="error-msg">${data._error}</div>`);
    card.insertAdjacentHTML("beforeend", `<div class="fetched-at">更新于 ${formatTime(data._fetchedAt)}</div>`);
    return card;
  }

  const normalized = normalizeData(inst.type, data);
  if (!normalized) {
    card.insertAdjacentHTML("beforeend", `<div class="error-msg">数据格式异常</div>`);
    card.insertAdjacentHTML("beforeend", `<div class="fetched-at">更新于 ${formatTime(data._fetchedAt)}</div>`);
    return card;
  }

  let bodyHtml = "";
  if (normalized.planType) {
    bodyHtml += `<span class="plan-type">${normalized.planType}</span>`;
  }
  for (const win of normalized.windows) {
    bodyHtml += renderWindowHtml(win);
  }
  bodyHtml += renderExtrasHtml(normalized.extras);

  card.insertAdjacentHTML("beforeend", bodyHtml);
  card.insertAdjacentHTML("beforeend", `<div class="fetched-at">更新于 ${formatTime(data._fetchedAt)}</div>`);
  return card;
}

function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}
