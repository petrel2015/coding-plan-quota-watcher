// common.js - popup 与 dashboard 共享的渲染、刷新协调与工具逻辑
// 依赖 render.js 提供: normalizeData / renderWindowHtml / renderExtrasHtml /
//   escapeHtml / formatNum / formatTime / pad（均在全局作用域）

// ------------------------------------------------------------
// 工具函数
// ------------------------------------------------------------

// 相对时间:"刚刚" / "X 秒前" / "X 分钟前" / "X 小时前" / "X 天前"
function formatRelativeTime(ts) {
  if (!ts) return "-";
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "刚刚";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 10) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

// ------------------------------------------------------------
// 卡片渲染（纯函数：给定 inst/data 返回 DOM 元素）
// ------------------------------------------------------------

function renderSourceCard(inst, data) {
  const card = document.createElement("div");
  card.className = "source-card";
  card.id = `card-${inst.id}`;
  card.dataset.instanceId = inst.id;

  // 提前归一化，以便在 header 内显示 planType 徽章
  let normalized = null;
  if (data && !(data._error && !data._hasValidData)) {
    try { normalized = normalizeData(inst.type, data); } catch (e) {}
  }

  // 头部：名称 + planType 徽章 + 右上角（相对时间 + 单卡刷新按钮）
  const header = document.createElement("div");
  header.className = "source-header";
  const planBadge = normalized && normalized.planType
    ? `<span class="plan-type">${escapeHtml(normalized.planType)}</span>`
    : "";
  header.innerHTML = `
    <div class="source-title">
      <span class="source-name">${escapeHtml(inst.name)}</span>
      ${planBadge}
    </div>
    <div class="card-controls">
      <span id="refreshed-at-${inst.id}" class="card-refreshed-at"></span>
      <button id="refresh-card-${inst.id}" class="card-refresh-btn" title="刷新此卡片">刷新</button>
    </div>
  `;
  card.appendChild(header);

  // 正文
  if (!data) {
    const note = document.createElement("div");
    note.className = "error-msg";
    note.textContent = "暂无数据，点击刷新获取";
    card.appendChild(note);
  } else if (data._lastError) {
    const warn = document.createElement("div");
    warn.className = "fetch-warn";
    warn.textContent = `获取失败（${data._lastError}），显示上次数据`;
    card.appendChild(warn);
    appendNormalized(card, normalized);
  } else if (data._error && !data._hasValidData) {
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = data._error;
    card.appendChild(err);
  } else {
    appendNormalized(card, normalized);
  }

  // 底部更新时间（相对时间，由 QuotaApp._refreshRelativeTimes 定时刷新文本）
  const ts = document.createElement("div");
  ts.className = "fetched-at";
  ts.id = `fetched-at-${inst.id}`;
  ts.dataset.fetchedAt = data && data._fetchedAt ? data._fetchedAt : "";
  ts.textContent = data && data._fetchedAt
    ? `更新于 ${formatRelativeTime(data._fetchedAt)}`
    : "";
  card.appendChild(ts);

  // 同步右上角相对时间
  const refreshedEl = card.querySelector(`#refreshed-at-${inst.id}`);
  if (refreshedEl && data && data._fetchedAt) {
    refreshedEl.textContent = formatRelativeTime(data._fetchedAt);
  }

  return card;
}

// 追加窗口/extras 到 card（normalized 已由调用方计算）
function appendNormalized(card, normalized) {
  if (!normalized) {
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "数据格式异常";
    card.appendChild(err);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "card-body";

  wrap.insertAdjacentHTML("beforeend", normalized.windows.map(renderWindowHtml).join(""));
  wrap.insertAdjacentHTML("beforeend", renderExtrasHtml(normalized.extras));

  card.appendChild(wrap);
}

// ------------------------------------------------------------
// 刷新协调器（popup / dashboard 共用）
// ------------------------------------------------------------

const QuotaApp = {
  // 当前已渲染的 instance id 集合，用于 storage 监听时判断是否需要更新
  _renderedIds: new Set(),
  // 正在刷新中的 instance id 集合（用于 loading 态）
  _refreshingIds: new Set(),
  // 全局刷新中标记
  _refreshingAll: false,
  // 相对时间自更新定时器
  _tickTimer: null,
  // 页面配置（由 init 注入）
  _config: null,

  /**
   * 初始化应用
   * @param {Object} config
   * @param {string} config.containerId - 卡片容器元素 id
   * @param {string} config.refreshAllBtnId - "全部刷新"按钮 id
   * @param {boolean} [config.useDisplayCols] - 是否根据 displayCols 设置 grid 列数（dashboard）
   * @param {string} [config.emptyText] - 无数据源时的提示文案
   */
  async init(config) {
    this._config = config;

    // 顶部"全部刷新"按钮
    const refreshAllBtn = document.getElementById(config.refreshAllBtnId);
    if (refreshAllBtn) {
      refreshAllBtn.addEventListener("click", () => this.refreshAll());
    }

    // 初次渲染
    await this.renderAll();

    // 监听后台 storage 变化，自动更新对应卡片
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      for (const key of Object.keys(changes)) {
        if (key === "instances") {
          // 实例列表变化（增删/启停）→ 整体重排
          this.renderAll();
        } else if (key.startsWith("data_")) {
          const id = key.slice(5);
          if (this._renderedIds.has(id)) {
            this.updateCard(id);
          }
        }
      }
    });

    // 每 15 秒自更新相对时间文本（不发请求）
    this._tickTimer = setInterval(() => this._refreshRelativeTimes(), 15000);
  },

  // 渲染全部卡片
  async renderAll() {
    const container = document.getElementById(this._config.containerId);
    container.innerHTML = "";
    this._renderedIds.clear();

    const keys = await chrome.storage.local.get(null);
    const instances = keys.instances || [];
    const enabled = instances.filter((i) => i.enabled);

    // dashboard 按设置调整列数
    if (this._config.useDisplayCols) {
      const cols = keys.displayCols || 2;
      container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }

    if (enabled.length === 0) {
      container.innerHTML = `<div class="empty">${this._config.emptyText || "暂无数据源"}</div>`;
      return;
    }

    for (const inst of enabled) {
      const data = keys[`data_${inst.id}`];
      const card = renderSourceCard(inst, data);
      container.appendChild(card);
      this._bindCardRefresh(inst.id);
      this._renderedIds.add(inst.id);
    }
  },

  // 绑定单卡刷新按钮
  _bindCardRefresh(instanceId) {
    const btn = document.getElementById(`refresh-card-${instanceId}`);
    if (btn) btn.addEventListener("click", () => this.refreshOne(instanceId));
  },

  // 更新单张卡片（不重排，仅替换 DOM）
  async updateCard(instanceId) {
    const keys = await chrome.storage.local.get(["instances", `data_${instanceId}`]);
    const instances = keys.instances || [];
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    const data = keys[`data_${instanceId}`];

    const oldCard = document.getElementById(`card-${instanceId}`);
    if (oldCard) {
      const newCard = renderSourceCard(inst, data);
      this._bindCardRefresh(instanceId);
      oldCard.replaceWith(newCard);
      // 若该卡片仍在刷新中，恢复 loading 态
      if (this._refreshingIds.has(instanceId)) {
        this._setCardLoading(instanceId, true);
      }
    }
  },

  // 刷新单个实例
  async refreshOne(instanceId) {
    if (this._refreshingIds.has(instanceId)) return;
    this._refreshingIds.add(instanceId);
    this._setCardLoading(instanceId, true);

    try {
      // 后台写完 storage 会触发 onChanged → updateCard
      await chrome.runtime.sendMessage({ action: "refreshOne", instanceId });
    } catch (e) {
      console.error("[QuotaWatcher] refreshOne failed:", e);
    } finally {
      this._refreshingIds.delete(instanceId);
      this._setCardLoading(instanceId, false);
    }
  },

  // 全部刷新（一次后台批量刷新，而非逐个发请求）
  async refreshAll() {
    if (this._refreshingAll) return;
    this._refreshingAll = true;
    this._setGlobalLoading(true);

    try {
      // 后台 refreshAll 串行刷新所有实例，resolve 时数据已写入 storage
      await chrome.runtime.sendMessage({ action: "refresh" });
    } catch (e) {
      console.error("[QuotaWatcher] refreshAll failed:", e);
    } finally {
      this._refreshingAll = false;
      this._setGlobalLoading(false);
    }
  },

  // 单卡 loading 态
  _setCardLoading(instanceId, loading) {
    const btn = document.getElementById(`refresh-card-${instanceId}`);
    const card = document.getElementById(`card-${instanceId}`);
    if (btn) {
      btn.disabled = loading;
      btn.textContent = loading ? "刷新中" : "刷新";
    }
    if (card) {
      card.classList.toggle("card-loading", loading);
    }
  },

  // 全局 loading 态（顶部按钮 + 所有卡片）
  _setGlobalLoading(loading) {
    const btn = document.getElementById(this._config.refreshAllBtnId);
    if (btn) {
      btn.disabled = loading;
      const original = btn.dataset.originalText || btn.textContent;
      if (loading) {
        btn.dataset.originalText = original;
        btn.textContent = "刷新中";
        btn.classList.add("btn-loading");
      } else {
        btn.textContent = original;
        btn.classList.remove("btn-loading");
      }
    }
    // 所有卡片进入 loading
    for (const id of this._renderedIds) {
      if (loading) this._refreshingIds.add(id);
      this._setCardLoading(id, loading);
      if (!loading) this._refreshingIds.delete(id);
    }
  },

  // 刷新所有相对时间文本（不发请求）
  _refreshRelativeTimes() {
    for (const id of this._renderedIds) {
      const tsEl = document.getElementById(`fetched-at-${id}`);
      if (!tsEl) continue;
      const fetchedAt = parseInt(tsEl.dataset.fetchedAt, 10);
      if (fetchedAt) {
        const text = `更新于 ${formatRelativeTime(fetchedAt)}`;
        tsEl.textContent = text;
        const refreshedEl = document.getElementById(`refreshed-at-${id}`);
        if (refreshedEl) refreshedEl.textContent = formatRelativeTime(fetchedAt);
      }
    }
  },
};
