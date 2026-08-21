<template>
  <div>
    <!-- topbar -->
    <div class="topbar">
      <h1>{{ t('dashboard.title') }}</h1>
      <div class="topbar-right">
        <el-button @click="goSettings">{{ t('dashboard.settings') }}</el-button>
        <el-button type="primary" :loading="refreshingAll" @click="refreshAll(false)">{{ t('dashboard.refreshAll') }}</el-button>
      </div>
    </div>

    <div class="sources-grid" :style="{ gridTemplateColumns: 'repeat(' + displayCols + ', 1fr)' }">
      <SourceCard
        v-for="inst in enabledInstances"
        :key="inst.id"
        :inst="inst"
        :data="dataMap[inst.id]"
        :loading="refreshingIds.has(inst.id)"
        :retryable="retryableIds.has(inst.id)"
        :timed-out="timedOutIds.has(inst.id)"
        :now="now"
        @refresh-one="refreshOne"
        @retry="retry"
      />
      <div v-if="enabledInstances.length === 0" class="empty">
        {{ t('dashboard.empty') }}
      </div>
    </div>
  </div>
</template>

<script>
import SourceCard from "./SourceCard.vue";
import { migrateInstances } from "../shared/sources.js";
import { applyTheme, setThemeAttr } from "../shared/theme.js";
import { diagnoseError, isTerminalAuthDiag } from "../shared/diagnose.js";
import { t, getLocale } from "../shared/i18n.js";

// 手动刷新时每张卡的最小转圈时间，避免太快闪一下看不到（自动刷新不受影响）
const MIN_LOADING_MS = 500;
// 转圈超过该时长（5s）后，卡片显示「点击重试」链接（仍在转圈，可提前触发重试）
const RETRY_SHOW_MS = 5000;
// 转圈超过该时长（30s）判定超时失败：停止转圈并提示失败
const LOADING_FALLBACK_TIMEOUT_MS = 30000;

export default {
  name: "DashboardApp",
  components: { SourceCard },
  data() {
    return {
      instances: [],
      dataMap: {}, // { [instanceId]: data }
      displayCols: 2,
      refreshingIds: new Set(), // 正在刷新的实例 id（注意：Set 需重新赋值触发响应式）
      refreshStartTimes: {}, // { [instanceId]: startTimeMs }，用于 500ms 最小展示
      retryableIds: new Set(), // 转圈≥5s 的实例 id：显示「点击重试」链接
      timedOutIds: new Set(), // 转圈≥30s 判定超时的实例 id：停止转圈并提示失败
      now: Date.now(),
    };
  },
  // 定时器句柄是内部簿记，模板不依赖，不进 data()（免走响应式）。
  // 且不能以 _ / $ 开头放 data()：Vue 2 不代理这类属性，this._xxx
  // 永远是 undefined —— markRefreshing 曾因此抛错，首卡进了 loading
  // 却没设上兜底定时器，永久转圈、全部刷新按钮永久不可点。
  created() {
    this.tickTimer = null;
    this.retryTimers = {}; // { [instanceId]: timer }，5s 显示重试链接
    this.fallbackTimers = {}; // { [instanceId]: timer }，30s 超时失败
  },
  computed: {
    enabledInstances() {
      return this.instances.filter((i) => i.enabled);
    },
    // 「全部刷新」按钮 loading：有任何卡在转就 loading
    refreshingAll() {
      return this.refreshingIds.size > 0;
    },
  },
  async mounted() {
    document.title = t("doc.dashboardTitle");
    document.documentElement.lang = getLocale();
    await applyTheme();
    await this.loadAll();
    // 监听 storage 变化
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    // 每 15 秒刷新相对时间（now 变化触发倒计时重算）
    this.tickTimer = setInterval(() => {
      this.now = Date.now();
    }, 15000);
    // 进入 dashboard 立即刷新一次（从 settings 改完配置回来能马上看到最新数据）
    // 自动刷新跳过已知登录失效的卡片，避免无意义的进度条闪烁
    this.refreshAll(true);
  },
  beforeDestroy() {
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const map of [this.retryTimers, this.fallbackTimers]) {
      for (const id of Object.keys(map)) clearTimeout(map[id]);
    }
  },
  methods: {
    t,
    async loadAll() {
      const { instances: raw, displayCols, theme } = await chrome.storage.local.get([
        "instances",
        "displayCols",
        "theme",
      ]);
      let instances = raw || [];
      if (raw) {
        const { instances: migrated, changed } = migrateInstances(raw);
        if (changed) {
          instances = migrated;
          await chrome.storage.local.set({ instances });
        }
      }
      this.instances = instances;
      this.displayCols = displayCols || 2;
      // 一次性拉取所有 data_* 缓存
      const dataKeys = this.enabledInstances.map((i) => `data_${i.id}`);
      const dataResult = await chrome.storage.local.get(dataKeys);
      const dataMap = {};
      for (const inst of this.enabledInstances) {
        dataMap[inst.id] = dataResult[`data_${inst.id}`];
      }
      this.dataMap = dataMap;
    },
    onStorageChanged(changes, area) {
      if (area !== "local") return;
      let needReloadInstances = false;
      let needReloadCols = false;
      let needReloadTheme = false;
      const dataUpdates = {};
      for (const key of Object.keys(changes)) {
        if (key === "instances") {
          needReloadInstances = true;
        } else if (key === "displayCols") {
          needReloadCols = true;
        } else if (key === "theme") {
          needReloadTheme = true;
        } else if (key.startsWith("data_")) {
          const id = key.slice(5);
          dataUpdates[id] = changes[key].newValue;
        }
      }
      if (needReloadInstances || needReloadCols) {
        this.loadAll();
      }
      if (needReloadTheme) {
        applyTheme();
      }
      if (Object.keys(dataUpdates).length > 0) {
        const newDataMap = { ...this.dataMap };
        for (const [id, val] of Object.entries(dataUpdates)) {
          newDataMap[id] = val;
          // 该实例后台已写入新数据 → 标记完成（逐卡停转圈）
          this.markDone(id);
        }
        this.dataMap = newDataMap;
      }
    },
    // 标记某实例开始刷新（记录开始时间，用于 500ms 最小展示）
    markRefreshing(id) {
      const newSet = new Set(this.refreshingIds);
      newSet.add(id);
      this.refreshingIds = newSet;
      this.refreshStartTimes = { ...this.refreshStartTimes, [id]: Date.now() };
      // 清掉上一次的定时器与超时/重试标记，重新计时
      this.clearCardTimers(id);
      const rt = new Set(this.retryableIds);
      rt.delete(id);
      this.retryableIds = rt;
      const to = new Set(this.timedOutIds);
      to.delete(id);
      this.timedOutIds = to;
      // 5s 后显示「点击重试」链接
      this.retryTimers[id] = setTimeout(() => this.markRetryable(id), RETRY_SHOW_MS);
      // 30s 判定超时失败（background 卡死/无响应时兜底，防止永久卡住）
      this.fallbackTimers[id] = setTimeout(() => this.markTimedOut(id), LOADING_FALLBACK_TIMEOUT_MS);
    },
    clearCardTimers(id) {
      if (this.retryTimers[id]) { clearTimeout(this.retryTimers[id]); delete this.retryTimers[id]; }
      if (this.fallbackTimers[id]) { clearTimeout(this.fallbackTimers[id]); delete this.fallbackTimers[id]; }
    },
    // 转圈≥5s：让该卡显示可点击的重试链接（仍保持转圈）
    markRetryable(id) {
      if (!this.refreshingIds.has(id)) return;
      const newSet = new Set(this.retryableIds);
      newSet.add(id);
      this.retryableIds = newSet;
    },
    // 转圈≥30s：停止转圈并标记为超时失败
    markTimedOut(id) {
      this.clearCardTimers(id);
      const rs = new Set(this.refreshingIds);
      rs.delete(id);
      this.refreshingIds = rs;
      const ts = { ...this.refreshStartTimes };
      delete ts[id];
      this.refreshStartTimes = ts;
      const rt = new Set(this.retryableIds);
      rt.delete(id);
      this.retryableIds = rt;
      const to = new Set(this.timedOutIds);
      to.add(id);
      this.timedOutIds = to;
    },
    // 标记某实例完成：清 loading，但保证手动刷新至少展示 500ms
    markDone(id) {
      this.clearCardTimers(id);
      const rt = new Set(this.retryableIds);
      rt.delete(id);
      this.retryableIds = rt;
      const to = new Set(this.timedOutIds);
      to.delete(id);
      this.timedOutIds = to;
      if (!this.refreshingIds.has(id)) return;
      const start = this.refreshStartTimes[id];
      const elapsed = start ? Date.now() - start : MIN_LOADING_MS;
      const clear = () => {
        const newSet = new Set(this.refreshingIds);
        newSet.delete(id);
        this.refreshingIds = newSet;
        const ts = { ...this.refreshStartTimes };
        delete ts[id];
        this.refreshStartTimes = ts;
      };
      if (elapsed >= MIN_LOADING_MS) {
        clear();
      } else {
        // 不足 500ms：补足后再清（setTimeout 期间仍显示转圈）
        setTimeout(clear, MIN_LOADING_MS - elapsed);
      }
    },
    // 该实例最近一次失败是否为「需要用户重新登录/补齐凭证」的终态错误：
    // 这类错误重试不会自愈，自动刷新时不应再触发转圈（避免无意义的进度条闪烁）
    isTerminalAuthError(inst) {
      const data = this.dataMap[inst.id];
      if (!data) return false;
      const err = data._error || data._lastError;
      if (!err) return false;
      const diag = data._diag || diagnoseError(err, { type: inst.type, authMode: inst.authMode });
      return isTerminalAuthDiag(diag);
    },
    async refreshAll(skipTerminal = false) {
      // 防重入：已有任何卡在转时不重复触发
      if (this.refreshingIds.size > 0) return;
      // 自动刷新（打开 dashboard）时跳过已知登录失效的卡片：静态展示错误即可，
      // 避免每次打开都闪进度条；手动「全部刷新」传 false，全部照常刷新。
      let targets = this.enabledInstances;
      if (skipTerminal) {
        targets = targets.filter((inst) => !this.isTerminalAuthError(inst));
      }
      // 所有 enabled 卡片各自进入独立 loading（蒙层）；逐张完成时由
      // onStorageChanged → markDone 逐张停，不再等整个 sendMessage resolve。
      for (const inst of targets) {
        this.markRefreshing(inst.id);
      }
      try {
        await chrome.runtime.sendMessage({ action: "refresh" });
      } catch (e) {
        console.error("[QuotaWatcher] refreshAll failed:", e);
        // 发送失败：兜底超时会清，这里不立即清，避免数据其实已更新的误清
      }
    },
    async refreshOne(instanceId) {
      if (this.refreshingIds.has(instanceId)) return;
      this.markRefreshing(instanceId);
      try {
        await chrome.runtime.sendMessage({ action: "refreshOne", instanceId });
      } catch (e) {
        console.error("[QuotaWatcher] refreshOne failed:", e);
      }
    },
    // 转圈≥5s 时点击「重试」：即使还在转圈也强制重新触发刷新，并重置计时
    async retry(instanceId) {
      this.markRefreshing(instanceId);
      try {
        await chrome.runtime.sendMessage({ action: "refreshOne", instanceId });
      } catch (e) {
        console.error("[QuotaWatcher] retry failed:", e);
      }
    },
    goSettings() {
      window.location.href = "settings.html";
    },
  },
};
</script>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 28px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  z-index: 10;
}
.topbar h1 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sources-grid {
  display: grid;
  gap: 16px;
  padding: 24px 28px 40px;
}
.empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 40px 0;
  font-size: 14px;
  grid-column: 1 / -1;
}
</style>
