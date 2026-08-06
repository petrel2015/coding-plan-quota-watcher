// dashboard.js - 全屏 dashboard 页面
// 每个卡片独立刷新，互不干扰

const AUTO_REFRESH_SEC = 10;
const cardTimers = {}; // instanceId -> { countdown, timer, refreshing }

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  document.getElementById("settings-btn").addEventListener("click", () => {
    window.location.href = "settings.html";
  });
  document.getElementById("refresh-all-btn").addEventListener("click", () => {
    refreshAllCards();
  });
});

async function renderAll() {
  const container = document.getElementById("sources");
  container.innerHTML = "";

  const keys = await chrome.storage.local.get(null);
  const cols = keys.displayCols || 2;
  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  const instances = keys.instances || [];
  const enabled = instances.filter((i) => i.enabled);

  if (enabled.length === 0) {
    container.innerHTML = '<div class="empty">暂无启用的数据源，请到设置页面添加</div>';
    return;
  }

  for (const inst of enabled) {
    const data = keys[`data_${inst.id}`];
    const card = renderSource(inst, data);
    container.appendChild(card);
    // 启动独立刷新计时
    startCardTimer(inst.id);
  }
}

function startCardTimer(instanceId) {
  // 清除旧计时器
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

  // 只更新这一张卡片
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
    <span class="source-name">${escapeHtml(inst.name)}</span>
    <div class="card-controls">
      <span id="timer-${inst.id}" class="card-timer">${AUTO_REFRESH_SEC}s</span>
      <button id="refresh-card-${inst.id}" class="card-refresh-btn">刷新</button>
    </div>
  `;
  card.appendChild(header);

  // 绑定刷新按钮
  setTimeout(() => {
    const btn = card.querySelector(`#refresh-card-${inst.id}`);
    if (btn) {
      btn.addEventListener("click", () => refreshCard(inst.id));
    }
  }, 0);

  // 首次无数据
  if (!data) {
    const note = document.createElement("div");
    note.className = "error-msg";
    note.textContent = "暂无数据，点击刷新获取";
    card.appendChild(note);
    return card;
  }

  // 有上次成功数据 + 本次失败
  if (data._lastError) {
    const warn = document.createElement("div");
    warn.className = "fetch-warn";
    warn.textContent = `获取失败（${data._lastError}），显示上次数据`;
    card.appendChild(warn);
  }

  // 完全无成功数据
  if (data._error && !data._hasValidData) {
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = data._error;
    card.appendChild(err);
    const ts = document.createElement("div");
    ts.className = "fetched-at";
    ts.textContent = `更新于 ${formatTime(data._fetchedAt)}`;
    card.appendChild(ts);
    return card;
  }

  // 正常渲染
  const normalized = normalizeData(inst.type, data);
  if (!normalized) {
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "数据格式异常";
    card.appendChild(err);
    const ts = document.createElement("div");
    ts.className = "fetched-at";
    ts.textContent = `更新于 ${formatTime(data._fetchedAt)}`;
    card.appendChild(ts);
    return card;
  }

  const wrap = document.createElement("div");

  if (normalized.planType) {
    const badge = document.createElement("span");
    badge.className = "plan-type";
    badge.textContent = normalized.planType;
    wrap.appendChild(badge);
  }

  for (const win of normalized.windows) {
    wrap.insertAdjacentHTML("beforeend", renderWindowHtml(win));
  }

  wrap.insertAdjacentHTML("beforeend", renderExtrasHtml(normalized.extras));

  card.appendChild(wrap);

  const ts = document.createElement("div");
  ts.className = "fetched-at";
  ts.textContent = `更新于 ${formatTime(data._fetchedAt)}`;
  card.appendChild(ts);

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
