// popup.js - 弹窗逻辑
// 每个卡片独立刷新，互不干扰

const AUTO_REFRESH_SEC = 10;
const cardTimers = {};

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  document.getElementById("dashboard-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  document.getElementById("refresh-btn").addEventListener("click", () => {
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
    const card = renderSourceCard(inst, data);
    container.appendChild(card);
    bindCardRefresh(inst.id);
    startCardTimer(inst.id);
  }
}

function bindCardRefresh(instanceId) {
  const btn = document.getElementById(`refresh-card-${instanceId}`);
  if (btn) btn.addEventListener("click", () => refreshCard(instanceId));
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
    const newCard = renderSourceCard(inst, data);
    bindCardRefresh(instanceId);
    oldCard.replaceWith(newCard);
  }
}
