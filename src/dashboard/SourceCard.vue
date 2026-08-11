<template>
  <div class="source-card" :class="{ 'card-loading': loading }">
    <!-- header：名称 + planType 徽章 + 刷新控件 -->
    <div class="source-header">
      <div class="source-title">
        <span class="source-name">{{ inst.name }}</span>
        <span v-if="normalized && normalized.planType" class="plan-type">{{ normalized.planType }}</span>
      </div>
      <div class="card-controls">
        <span v-if="data && data._fetchedAt" class="card-refreshed-at">{{ refreshedText }}</span>
        <el-button
          size="mini"
          class="card-refresh-btn"
          :disabled="loading"
          @click="$emit('refresh-one', inst.id)"
        >{{ loading ? "刷新中" : "刷新" }}</el-button>
      </div>
    </div>

    <!-- 正文 -->
    <template v-if="!data">
      <div class="error-msg">暂无数据，点击刷新获取</div>
    </template>
    <template v-else-if="data._lastError">
      <div class="fetch-warn">获取失败（{{ data._lastError }}），显示上次数据</div>
      <div v-if="normalized" class="card-body" v-html="windowsHtml"></div>
      <div v-else class="error-msg">数据格式异常</div>
    </template>
    <template v-else-if="data._error && !data._hasValidData">
      <div class="error-msg">{{ data._error }}</div>
    </template>
    <template v-else>
      <div v-if="normalized" class="card-body">
        <div v-for="(win, i) in normalized.windows" :key="i" class="window">
          <div class="window-header">
            <span class="window-label">{{ win.label }}</span>
            <span class="window-used">{{ (win.usedPct || 0).toFixed(1) }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :class="barClass(win.usedPct)" :style="{ width: Math.min(win.usedPct || 0, 100) + '%' }"></div>
          </div>
          <div v-if="win.detail" class="window-detail">{{ win.detail }}</div>
          <div v-if="forecast(win)" class="window-forecast" :class="'forecast-' + forecast(win).level">
            {{ forecast(win).text }}
          </div>
          <div class="window-footer">
            <span class="reset-time" :class="{ 'reset-done': isReset(win) }">{{ resetText(win) }}</span>
          </div>
        </div>
        <div v-for="(ex, i) in normalizedExtras" :key="'ex' + i" class="window-detail">{{ ex.label }}: {{ ex.value }}</div>
      </div>
      <div v-else class="error-msg">数据格式异常</div>
    </template>

    <!-- 更新时间 -->
    <div v-if="data && data._fetchedAt" class="fetched-at">更新于 {{ refreshedText }}</div>
  </div>
</template>

<script>
import { normalizeData, computeForecast } from "../shared/render.js";
import { formatRelativeTime, formatCountdown, escapeHtml } from "../shared/format.js";

export default {
  name: "SourceCard",
  props: {
    inst: { type: Object, required: true },
    data: { type: Object, default: null },
    loading: { type: Boolean, default: false },
    now: { type: Number, default: () => Date.now() }, // 用于倒计时刷新
  },
  computed: {
    normalized() {
      if (!this.data || (this.data._error && !this.data._hasValidData)) return null;
      try {
        return normalizeData(this.inst.type, this.data);
      } catch (e) {
        return null;
      }
    },
    normalizedExtras() {
      if (!this.normalized || !this.normalized.extras) return [];
      return this.normalized.extras.filter((ex) => ex.value != null);
    },
    refreshedText() {
      if (!this.data || !this.data._fetchedAt) return "";
      return formatRelativeTime(this.data._fetchedAt);
    },
  },
  methods: {
    barClass(pct) {
      pct = pct || 0;
      if (pct >= 90) return "bar-danger";
      if (pct >= 70) return "bar-warn";
      return "bar-ok";
    },
    forecast(win) {
      return computeForecast(win);
    },
    isReset(win) {
      return win.resetMs - this.now <= 0;
    },
    resetText(win) {
      if (!win.resetMs) return "\u00a0";
      const resetInMs = win.resetMs - this.now;
      if (resetInMs <= 0) return "已重置";
      return "重置倒计时 " + formatCountdown(resetInMs);
    },
  },
};
</script>

<style scoped>
.source-card {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 18px;
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.15s, border-color 0.15s;
  position: relative;
}
.source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}
.source-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.source-name {
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-type {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--color-text-secondary);
  background: var(--color-bg-subtle);
  border: 1px solid var(--color-border);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  text-transform: uppercase;
}
.card-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-refreshed-at {
  font-size: 11px;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 48px;
  text-align: right;
}
.card-body {
  /* 占位 */
}
.window {
  margin-bottom: 14px;
}
.window:last-child {
  margin-bottom: 0;
}
.window-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.window-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
.window-used {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.progress-bar {
  height: 6px;
  background: var(--progress-track);
  border-radius: var(--radius-pill);
  overflow: hidden;
  margin-bottom: 6px;
}
.progress-fill {
  height: 100%;
  border-radius: var(--radius-pill);
}
.bar-ok { background: var(--color-ok); }
.bar-warn { background: var(--color-warn); }
.bar-danger { background: var(--color-danger); }
.window-detail {
  font-size: 11px;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
  margin-bottom: 4px;
}
.window-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}
.reset-time {
  font-variant-numeric: tabular-nums;
}
.reset-done {
  color: var(--color-ok);
}
.window-forecast {
  font-size: 11px;
  margin-bottom: 5px;
  padding: 4px 8px 4px 10px;
  border-radius: var(--radius-btn);
  font-variant-numeric: tabular-nums;
  border: 1px solid;
  border-left-width: 2px;
}
.forecast-ok {
  color: var(--color-ok);
  background: var(--color-ok-bg);
  border-color: var(--color-ok-border);
}
.forecast-warn {
  color: var(--color-danger);
  background: var(--color-danger-bg);
  border-color: var(--color-danger-border);
}
.fetched-at {
  margin-top: 10px;
  font-size: 11px;
  color: var(--color-text-mute);
  text-align: right;
}
.error-msg {
  color: var(--color-danger);
  font-size: 12px;
  margin-bottom: 6px;
  word-break: break-all;
}
.fetch-warn {
  font-size: 11.5px;
  color: var(--color-warn);
  background: var(--color-warn-bg);
  border: 1px solid var(--color-warn-border);
  border-left-width: 2px;
  border-radius: var(--radius-btn);
  padding: 5px 9px;
  margin-bottom: 10px;
}
.card-loading {
  opacity: 0.7;
}
.card-loading::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  width: 30%;
  background: var(--color-accent);
  border-radius: 2px;
  animation: card-loading-slide 1.1s ease-in-out infinite;
}
@keyframes card-loading-slide {
  0% { left: -30%; }
  100% { left: 100%; }
}
</style>
