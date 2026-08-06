// common.js - popup 与 dashboard 共享的渲染与工具逻辑
// 依赖 render.js 提供: normalizeData / renderWindowHtml / renderExtrasHtml /
//   escapeHtml / formatNum / formatTime / pad（均在全局作用域）

// 相对时间:"刚刚" / "X 秒前" / "X 分钟前" / "X 小时前"
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

// 渲染单张数据源卡片
// inst: instance 配置; data: storage 缓存的 data_<id>
// 返回一个 DOM 元素(含 id=card-<inst.id>)
function renderSourceCard(inst, data) {
  const card = document.createElement("div");
  card.className = "source-card";
  card.id = `card-${inst.id}`;

  const header = document.createElement("div");
  header.className = "source-header";
  header.innerHTML = `
    <span class="source-name">${escapeHtml(inst.name)}</span>
    <div class="card-controls">
      <span id="timer-${inst.id}" class="card-timer"></span>
      <button id="refresh-card-${inst.id}" class="card-refresh-btn" title="刷新此卡片">刷新</button>
    </div>
  `;
  card.appendChild(header);

  // 渲染卡片正文
  if (!data) {
    const note = document.createElement("div");
    note.className = "error-msg";
    note.textContent = "暂无数据，点击刷新获取";
    card.appendChild(note);
  } else if (data._lastError) {
    // 有上次成功数据 + 本次失败
    const warn = document.createElement("div");
    warn.className = "fetch-warn";
    warn.textContent = `获取失败（${data._lastError}），显示上次数据`;
    card.appendChild(warn);
    appendNormalized(card, inst, data);
  } else if (data._error && !data._hasValidData) {
    // 完全无成功数据
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = data._error;
    card.appendChild(err);
  } else {
    appendNormalized(card, inst, data);
  }

  // 更新时间（底部，相对时间）
  if (data && data._fetchedAt) {
    const ts = document.createElement("div");
    ts.className = "fetched-at";
    ts.id = `fetched-at-${inst.id}`;
    ts.textContent = `更新于 ${formatTime(data._fetchedAt)}`;
    card.appendChild(ts);
  }

  return card;
}

// 归一化并追加窗口/extras 到 card
function appendNormalized(card, inst, data) {
  const normalized = normalizeData(inst.type, data);
  if (!normalized) {
    const err = document.createElement("div");
    err.className = "error-msg";
    err.textContent = "数据格式异常";
    card.appendChild(err);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "card-body";

  if (normalized.planType) {
    const badge = document.createElement("span");
    badge.className = "plan-type";
    badge.textContent = normalized.planType;
    wrap.appendChild(badge);
  }

  wrap.insertAdjacentHTML("beforeend", normalized.windows.map(renderWindowHtml).join(""));
  wrap.insertAdjacentHTML("beforeend", renderExtrasHtml(normalized.extras));

  card.appendChild(wrap);
}
