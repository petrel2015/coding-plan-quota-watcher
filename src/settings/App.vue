<template>
  <div>
    <!-- topbar -->
    <div class="topbar">
      <h1>{{ t('settings.title') }}</h1>
      <el-button @click="goBack">{{ t('settings.back') }}</el-button>
    </div>

    <div class="content">
      <!-- 显示设置 -->
      <div class="section">
        <div class="section-header">
          <h2>{{ t('settings.display') }}</h2>
        </div>
        <div class="field-row">
          <span class="field-label">{{ t('settings.cols') }}</span>
          <el-select v-model="displayCols" @change="onColsChange" style="width:120px;">
            <el-option :label="t('settings.colOne')" :value="1" />
            <el-option :label="t('settings.colTwo')" :value="2" />
            <el-option :label="t('settings.colThree')" :value="3" />
          </el-select>
        </div>
        <div class="field-row">
          <span class="field-label">{{ t('settings.theme') }}</span>
          <el-select v-model="theme" @change="onThemeChange" style="width:120px;">
            <el-option :label="t('settings.themeAuto')" value="auto" />
            <el-option :label="t('settings.themeLight')" value="light" />
            <el-option :label="t('settings.themeDark')" value="dark" />
          </el-select>
        </div>
      </div>

      <!-- 数据源 -->
      <div class="section">
        <div class="section-header">
          <h2>{{ t('settings.sources') }}</h2>
          <el-button type="primary" @click="addInstance">{{ t('settings.add') }}</el-button>
        </div>
        <div id="instances">
          <InstanceCard
            v-for="(inst, idx) in instances"
            :key="inst.id"
            :inst="inst"
            :all-instances="instances"
            :index="idx"
            :last-index="instances.length - 1"
            :login-status="loginStatusMap"
            :test-result="testResultMap"
            @update="onCardUpdate"
            @move="moveInstance"
            @delete="confirmDelete"
            @auth-blocked="onAuthBlocked"
            @test-connection="testConnection"
          />
          <div v-if="instances.length === 0" class="empty">{{ t('settings.empty') }}</div>
        </div>
      </div>
    </div>

    <!-- toast -->
    <div class="toast" :class="{ show: toastVisible }">{{ toastMsg }}</div>
  </div>
</template>

<script>
import Vue from "vue";
import InstanceCard from "./InstanceCard.vue";
import {
  SOURCE_TEMPLATES,
  DEFAULT_INSTANCES,
  migrateInstances,
  generateInstanceName,
} from "../shared/sources.js";
import { applyTheme, setThemeAttr } from "../shared/theme.js";
import { t, getLocale } from "../shared/i18n.js";

export default {
  name: "SettingsApp",
  components: { InstanceCard },
  data() {
    return {
      instances: [],
      displayCols: 2,
      theme: "auto",
      loginStatusMap: {}, // { [instanceId]: { state, count, message } }
      testResultMap: {}, // { [instanceId]: { state: "testing"|"ok"|"fail", diag? } }
      toastVisible: false,
      toastMsg: "",
    };
  },
  // toast 定时器句柄不进 data()（模板不依赖）；也别用 _ 前缀 ——
  // Vue 2 不代理 data() 里 _ / $ 开头的属性，this._xxx 会是 undefined
  created() {
    this.toastTimer = null;
  },
  async mounted() {
    document.title = t("doc.settingsTitle");
    document.documentElement.lang = getLocale();
    await applyTheme();
    await this.loadAll();
  },
  methods: {
    t,
    async loadAll() {
      const { instances: raw, displayCols, theme } = await chrome.storage.local.get([
        "instances",
        "displayCols",
        "theme",
      ]);
      // 字段迁移
      let instances = raw;
      if (!instances) {
        instances = DEFAULT_INSTANCES;
        await chrome.storage.local.set({ instances });
      } else {
        const { instances: migrated, changed } = migrateInstances(instances);
        if (changed) {
          instances = migrated;
          await chrome.storage.local.set({ instances });
        }
      }
      this.instances = instances;
      this.displayCols = displayCols || 2;
      this.theme = theme || "auto";
      // 对所有 local 实例触发登录检测
      this.instances.forEach((inst) => {
        const locked = this.isLocalLocked(inst);
        const effectiveAuth = locked ? "manual" : inst.authMode;
        if (effectiveAuth === "local") this.checkLoginStatus(inst);
      });
    },
    // 判断 local 锁定（与 InstanceCard 逻辑一致）
    isLocalLocked(inst) {
      const myIdx = this.instances.findIndex((x) => x.id === inst.id);
      if (myIdx < 0) return false;
      return this.instances.some(
        (o, idx) => idx < myIdx && o.type === inst.type && o.authMode === "local"
      );
    },
    // 登录态检测
    async checkLoginStatus(inst) {
      Vue.set(this.loginStatusMap, inst.id, { state: "checking" });
      const tmpl = SOURCE_TEMPLATES[inst.type];
      if (!tmpl || !tmpl.cookieDomains) {
        Vue.set(this.loginStatusMap, inst.id, { state: "unknown", message: t("settings.unknownSource") });
        return;
      }
      try {
        let total = 0;
        const seen = new Set();
        for (const d of tmpl.cookieDomains) {
          try {
            const cookies = await chrome.cookies.getAll({ domain: d });
            for (const c of cookies) {
              const key = `${c.name}@${c.domain}@${c.path}`;
              if (!seen.has(key)) {
                seen.add(key);
                total++;
              }
            }
          } catch (e) {}
        }
        if (total > 0) {
          Vue.set(this.loginStatusMap, inst.id, { state: "ok", count: total });
        } else {
          Vue.set(this.loginStatusMap, inst.id, { state: "miss" });
        }
      } catch (e) {
        Vue.set(this.loginStatusMap, inst.id, {
          state: "unknown",
          message: t("settings.checkFailed", { msg: e.message }),
        });
      }
    },
    // 卡片字段更新（自动保存）
    async onCardUpdate(fields, opts = {}) {
      const idx = this.instances.findIndex((i) => i.id === fields.id);
      if (idx < 0) return;
      // 更新 instances 数组
      this.instances[idx] = { ...this.instances[idx], ...fields };
      await chrome.storage.local.set({ instances: this.instances });
      this.showToast(t("settings.saved"));
      // 锁定态/登录态需要重算时，触发各 local 实例的检测
      if (opts.reloadAll) {
        // 重新检测所有 local 实例
        this.instances.forEach((inst) => {
          const locked = this.isLocalLocked(inst);
          const effectiveAuth = locked ? "manual" : inst.authMode;
          if (effectiveAuth === "local") this.checkLoginStatus(inst);
        });
      }
    },
    // 锁定态下用户尝试切 local：弹出原因说明（替代原本"闪一下无提示"的行为）
    onAuthBlocked(payload) {
      if (payload?.reason) this.showToast(payload.reason, 4000);
    },
    // 测试连接：把当前卡片最新字段发给 background 真实请求一次，结果写进 testResultMap
    async testConnection(inst) {
      if (!inst || !inst.id) return;
      Vue.set(this.testResultMap, inst.id, { state: "testing" });
      // manual 模式但没填 curl：直接本地报错，不发请求
      if (inst.authMode === "manual" && !inst.manualCurl) {
        Vue.set(this.testResultMap, inst.id, {
          state: "fail",
          diag: {
            title: t("settings.testMissingCurlTitle"),
            detail: t("settings.testMissingCurlDetail"),
            advice: t("settings.testMissingCurlAdvice"),
          },
        });
        return;
      }
      try {
        const resp = await chrome.runtime.sendMessage({ action: "testConnection", instance: inst });
        if (resp && resp.ok) {
          Vue.set(this.testResultMap, inst.id, { state: "ok" });
        } else {
          Vue.set(this.testResultMap, inst.id, { state: "fail", diag: (resp && resp.diag) || null });
        }
      } catch (e) {
        Vue.set(this.testResultMap, inst.id, {
          state: "fail",
          diag: { title: t("settings.testFailTitle"), detail: e.message || String(e), advice: t("settings.testFailAdvice") },
        });
      }
    },
    async addInstance() {
      const type = "volcengine-ark";
      const name = generateInstanceName(type, this.instances);
      const newInst = {
        id: `${Date.now()}`,
        name,
        type,
        enabled: true,
        authMode: "local",
        manualCurl: "",
        nameCustomized: false,
      };
      // 加到最上面，避免新增后还要滚动到底部编辑
      this.instances.unshift(newInst);
      await chrome.storage.local.set({ instances: this.instances });
    },
    async confirmDelete(instanceId, name) {
      if (!confirm(t("settings.deleteConfirm", { name }))) return;
      await this.moveInstance(instanceId, 0, true); // 先确保最新数据已存
      const idx = this.instances.findIndex((i) => i.id === instanceId);
      if (idx < 0) return;
      this.instances.splice(idx, 1);
      await chrome.storage.local.set({ instances: this.instances });
    },
    async moveInstance(instanceId, dir, skipConfirm = false) {
      const idx = this.instances.findIndex((i) => i.id === instanceId);
      if (idx < 0) return;
      const newIndex = idx + dir;
      if (newIndex < 0 || newIndex >= this.instances.length) return;
      const tmp = this.instances[idx];
      this.instances[idx] = this.instances[newIndex];
      this.instances[newIndex] = tmp;
      // 强制响应式刷新（数组索引赋值）
      this.instances = [...this.instances];
      await chrome.storage.local.set({ instances: this.instances });
    },
    onColsChange(val) {
      chrome.storage.local.set({ displayCols: val });
    },
    onThemeChange(val) {
      chrome.storage.local.set({ theme: val });
      setThemeAttr(val);
    },
    goBack() {
      window.location.href = "dashboard.html";
    },
    showToast(msg, duration = 2000) {
      this.toastMsg = msg;
      this.toastVisible = true;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toastVisible = false;
      }, duration);
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
.content {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 40px;
}
.section {
  background: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  padding: 22px;
  box-shadow: var(--shadow-card);
  margin-bottom: 18px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}
.section-header h2 {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
}
.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
}
.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  width: 56px;
  flex-shrink: 0;
}
.empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 40px 0;
  font-size: 14px;
}
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-text);
  color: var(--color-card);
  padding: 9px 18px;
  border-radius: var(--radius-btn);
  font-size: 12.5px;
  font-weight: 500;
  box-shadow: var(--shadow-pop);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 100;
  pointer-events: none;
}
.toast.show {
  opacity: 1;
}
</style>
