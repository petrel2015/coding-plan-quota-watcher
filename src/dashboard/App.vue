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
        :loading="refreshingIds.has(inst.id) || refreshingAll"
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

export default {
  name: "DashboardApp",
  components: { SourceCard },
  data() {
    return {
      instances: [],
      dataMap: {}, // { [instanceId]: data }
      displayCols: 2,
      refreshingAll: false,
      refreshingIds: new Set(), // 注意：Set 需要用 Vue.set 重新赋值触发响应式
      now: Date.now(),
      _tickTimer: null,
    };
  },
  computed: {
    enabledInstances() {
      return this.instances.filter((i) => i.enabled);
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
  },
  beforeDestroy() {
    chrome.storage.onChanged.removeListener(this.onStorageChanged);
    if (this._tickTimer) clearInterval(this._tickTimer);
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
        }
        this.dataMap = newDataMap;
      }
    },
    async refreshAll() {
      if (this.refreshingAll) return;
      this.refreshingAll = true;
      try {
        await chrome.runtime.sendMessage({ action: "refresh" });
      } catch (e) {
        console.error("[QuotaWatcher] refreshAll failed:", e);
      } finally {
        this.refreshingAll = false;
      }
    },
    async refreshOne(instanceId) {
      if (this.refreshingIds.has(instanceId)) return;
      const newSet = new Set(this.refreshingIds);
      newSet.add(instanceId);
      this.refreshingIds = newSet;
      try {
        await chrome.runtime.sendMessage({ action: "refreshOne", instanceId });
      } catch (e) {
        console.error("[QuotaWatcher] refreshOne failed:", e);
      } finally {
        const doneSet = new Set(this.refreshingIds);
        doneSet.delete(instanceId);
        this.refreshingIds = doneSet;
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
