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
        >{{ loading ? t('card.refreshing') : t('card.refresh') }}</el-button>
      </div>
    </div>

    <!-- 刷新状态提示：超时失败 / 可点击重试 -->
    <div v-if="timedOut" class="retry-block retry-error">
      <span class="retry-msg">{{ t('card.timeout') }}</span>
      <a href="javascript:;" class="retry-link" @click="$emit('retry', inst.id)">{{ t('card.retry') }}</a>
    </div>
    <div v-else-if="loading && retryable" class="retry-block">
      <span class="retry-msg">{{ t('card.slow') }}</span>
      <a href="javascript:;" class="retry-link" @click="$emit('retry', inst.id)">{{ t('card.retry') }}</a>
    </div>

    <!-- 正文 -->
    <template v-if="!data">
      <div class="error-msg">{{ t('card.noData') }}</div>
    </template>
    <template v-else-if="data._lastError">
      <div class="diag-block diag-warn">
        <div class="diag-title">{{ t('card.showLast') }} · {{ diag && diag.title }}</div>
        <div v-if="diag && diag.detail" class="diag-detail">{{ diag.detail }}</div>
        <div v-if="diag && diag.advice" class="diag-advice">{{ diag.advice }}</div>
      </div>
      <div v-if="normalized" class="card-body" v-html="windowsHtml"></div>
      <div v-else class="error-msg">{{ t('card.formatError') }}</div>
    </template>
    <template v-else-if="data._error && !data._hasValidData">
      <div class="diag-block diag-error">
        <div class="diag-title">{{ (diag && diag.title) || t('card.fetchFailed') }}</div>
        <div v-if="diag && diag.detail" class="diag-detail">{{ diag.detail }}</div>
        <div v-if="diag && diag.advice" class="diag-advice">{{ diag.advice }}</div>
      </div>
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
      <div v-else class="error-msg">{{ t('card.formatError') }}</div>
    </template>

    <!-- 更新时间 -->
    <div v-if="data && data._fetchedAt" class="fetched-at">{{ t('card.updated', { time: refreshedText }) }}</div>
  </div>
</template>

<script>
import { normalizeData, computeForecast } from "../shared/render.js";
import { formatRelativeTime, formatCountdown, escapeHtml } from "../shared/format.js";
import { diagnoseError } from "../shared/diagnose.js";
import { t } from "../shared/i18n.js";

export default {
  name: "SourceCard",
  props: {
    inst: { type: Object, required: true },
    data: { type: Object, default: null },
    loading: { type: Boolean, default: false },
    retryable: { type: Boolean, default: false }, // 转圈≥5s，显示「点击重试」链接
    timedOut: { type: Boolean, default: false }, // 转圈≥30s，判定超时失败
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
    // 失败诊断：优先用 background 写入的 _diag；老缓存没有时现场归类
    diag() {
      if (!this.data) return null;
      const hasError = this.data._error || this.data._lastError;
      if (!hasError) return null;
      if (this.data._diag) return this.data._diag;
      return diagnoseError(hasError, {
        type: this.inst.type,
        authMode: this.inst.authMode,
      });
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
    t,
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
      if (resetInMs <= 0) return t("card.reset");
      return t("card.countdown", { time: formatCountdown(resetInMs) });
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
/* 刷新状态提示条（5s 可重试 / 30s 超时失败） */
.retry-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  border-radius: var(--radius-btn);
  padding: 6px 10px;
  margin-bottom: 10px;
}
.retry-msg {
  color: var(--color-text-secondary);
}
.retry-link {
  color: var(--color-accent);
  cursor: pointer;
  text-decoration: none;
  font-weight: 500;
  flex-shrink: 0;
}
.retry-link:hover {
  text-decoration: underline;
  color: var(--color-accent-hover);
}
.retry-error {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
}
.retry-error .retry-msg {
  color: var(--color-danger);
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
/* 诊断块：失败时的「类别 + 详情 + 建议」三行结构 */
.diag-block {
  border-radius: var(--radius-btn);
  padding: 7px 10px;
  margin-bottom: 10px;
  border-left-width: 3px;
  border-left-style: solid;
}
.diag-warn {
  background: var(--color-warn-bg);
  border-color: var(--color-warn);
}
.diag-error {
  background: var(--color-danger-bg);
  border-color: var(--color-danger);
}
.diag-title {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 3px;
}
.diag-warn .diag-title { color: var(--color-warn); }
.diag-error .diag-title { color: var(--color-danger); }
.diag-detail {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  word-break: break-all;
  margin-bottom: 2px;
}
.diag-advice {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.45;
}
</style>
