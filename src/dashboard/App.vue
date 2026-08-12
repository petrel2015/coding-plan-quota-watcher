<template>
  <div>
    <!-- topbar -->
    <div class="topbar">
      <h1>Coding Plan 用量监控</h1>
      <div class="topbar-right">
        <el-button @click="goSettings">设置</el-button>
        <el-button type="primary" :loading="refreshingAll" @click="refreshAll">全部刷新</el-button>
      </div>
    </div>

    <div class="sources-grid" :style="{ gridTemplateColumns: 'repeat(' + displayCols + ', 1fr)' }">
      <SourceCard
        v-for="inst in enabledInstances"
        :key="inst.id"
        :inst="inst"
        :data="dataMap[inst.id]"
        :loading="refreshingIds.has(inst.id)"
        :now="now"
        @refresh-one="refreshOne"
      />
      <div v-if="enabledInstances.length === 0" class="empty">
        暂无启用的数据源，请到设置页面添加
      </div>
    </div>
  </div>
</template>

<script>
import SourceCard from "./SourceCard.vue";
import { migrateInstances } from "../shared/sources.js";
import { applyTheme, setThemeAttr } from "../shared/theme.js";

// 手动刷新时每张卡的最小转圈时间，避免太快闪一下看不到（自动刷新不受影响）
const MIN_LOADING_MS = 500;
// loading 兜底超时：即使 background 完全无响应，也强制清掉转圈，防止永久卡住
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
      now: Date.now(),
      _tickTimer: null,
    };
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
    await applyTheme();
    await this.loadAll();
    // 监听 storage 变化
    chrome.storage.onChanged.addListener(this.onStorageChanged);
    // 每 15 秒刷新相对时间（now 变化触发倒计时重算）
    this._tickTimer = setInterval(() => {
      this.now = Date.now();
    }, 15000);
    // 进入 dashboard 立即刷新一次（从 settings 改完配置回来能马上看到最新数据）
    this.refreshAll();
  },
  beforeDestroy() {
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    if (this._tickTimer) clearInterval(this._tickTimer);
    if (this._fallbackTimers) {
      for (const id of Object.keys(this._fallbackTimers)) {
        clearTimeout(this._fallbackTimers[id]);
      }
    }
  },
  methods: {
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
      // 兜底：若迟迟没有 data_ 回写（background 卡死/无响应），强制清掉
      if (this._fallbackTimers == null) this._fallbackTimers = {};
      clearTimeout(this._fallbackTimers[id]);
      this._fallbackTimers[id] = setTimeout(() => this.markDone(id), LOADING_FALLBACK_TIMEOUT_MS);
    },
    // 标记某实例完成：清 loading，但保证手动刷新至少展示 500ms
    markDone(id) {
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
        if (this._fallbackTimers && this._fallbackTimers[id]) {
          clearTimeout(this._fallbackTimers[id]);
          delete this._fallbackTimers[id];
        }
      };
      if (elapsed >= MIN_LOADING_MS) {
        clear();
      } else {
        // 不足 500ms：补足后再清（setTimeout 期间仍显示转圈）
        setTimeout(clear, MIN_LOADING_MS - elapsed);
      }
    },
    async refreshAll() {
      // 防重入：已有任何卡在转时不重复触发
      if (this.refreshingIds.size > 0) return;
      // 所有 enabled 卡片各自进入独立 loading（蒙层）；逐张完成时由
      // onStorageChanged → markDone 逐张停，不再等整个 sendMessage resolve。
      for (const inst of this.enabledInstances) {
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
