<template>
  <div class="instance-card" :class="{ disabled: !inst.enabled }">
    <!-- 第一行：开关 + 名称 + 上移/下移/删除 -->
    <div class="instance-row">
      <el-switch v-model="localEnabled" :disabled="false" @change="onFieldChange" />
      <el-input
        v-model="localName"
        class="instance-name-input"
        @blur="onFieldChange"
        @change="onFieldChange"
      />
      <el-button size="mini" :disabled="index === 0" @click="$emit('move', inst.id, -1)">↑</el-button>
      <el-button size="mini" :disabled="index === lastIndex" @click="$emit('move', inst.id, 1)">↓</el-button>
      <el-button size="mini" type="danger" plain @click="onDelete">删除</el-button>
    </div>

    <!-- 类型 -->
    <div class="field-row">
      <span class="field-label">类型</span>
      <el-select v-model="localType" @change="onTypeChange" class="field-input">
        <el-option v-for="(tmpl, key) in templates" :key="key" :label="tmpl.name" :value="key" />
      </el-select>
    </div>

    <!-- 鉴权（锁定时用 el-tooltip 包裹，悬浮提示原因） -->
    <div class="field-row">
      <span class="field-label">鉴权</span>
      <el-tooltip
        :disabled="!localLocked"
        content="同一平台已有数据源占用浏览器自动获取，本卡只能手动粘贴"
        placement="top"
      >
        <div class="auth-select-wrapper">
          <el-select
            v-model="effectiveAuthMode"
            :disabled="localLocked"
            class="field-input"
            @change="onAuthChange"
          >
            <el-option label="本地 Cookie（自动）" value="local" :disabled="localLocked" />
            <el-option label="手动粘贴 Cookie" value="manual" />
          </el-select>
        </div>
      </el-tooltip>
    </div>

    <!-- local 模式：登录态检测 -->
    <div v-if="effectiveAuthMode === 'local'" class="field-row login-status-row">
      <span class="field-label">状态</span>
      <div class="login-status-content">
        <span v-if="loginChecking" class="login-status-text login-checking">检测中...</span>
        <span v-else-if="loginOk" class="login-status-text login-ok">
          ✓ 已检测到登录信息（{{ loginCount }} 条 Cookie）
        </span>
        <template v-else-if="loginMiss">
          <span class="login-status-text login-miss">未检测到登录信息</span>
          <el-button size="mini" type="primary" @click="openLogin">立即登录</el-button>
        </template>
        <span v-else class="login-status-text login-unknown">{{ loginMessage }}</span>
      </div>
    </div>

    <!-- manual 模式：curl 输入 -->
    <div v-if="effectiveAuthMode === 'manual'" class="manual-cookie-row">
      <div class="field-row">
        <span class="field-label">curl</span>
      </div>
      <el-input
        v-model="localCurl"
        type="textarea"
        :rows="2"
        :placeholder="curlPlaceholder"
        class="cookie-textarea"
        @blur="onFieldChange"
      />
      <div class="cookie-hint">{{ curlHint }}</div>
      <!-- minimax 的第二个 curl（套餐名） -->
      <div v-if="showCurl2" class="manual-cookie2-row">
        <div class="field-row">
          <span class="field-label">curl2 (套餐名)</span>
        </div>
        <el-input
          v-model="localCurl2"
          type="textarea"
          :rows="2"
          :placeholder="curl2Placeholder"
          class="cookie-textarea"
          @blur="onFieldChange"
        />
        <div class="cookie-hint">{{ curl2Hint }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import { SOURCE_TEMPLATES } from "../shared/sources.js";

export default {
  name: "InstanceCard",
  props: {
    inst: { type: Object, required: true },
    allInstances: { type: Array, default: () => [] },
    index: { type: Number, default: 0 },
    lastIndex: { type: Number, default: 0 },
    loginStatus: { type: Object, default: () => ({}) },
  },
  data() {
    return {
      templates: SOURCE_TEMPLATES,
      // 本地编辑态（避免直接改 prop，blur 时再同步）
      localEnabled: this.inst.enabled,
      localName: this.inst.name,
      localType: this.inst.type,
      localCurl: this.inst.manualCurl || this.inst.manualCookie || "",
      localCurl2: this.inst.manualCurl2 || "",
    };
  },
  computed: {
    template() {
      return SOURCE_TEMPLATES[this.localType] || null;
    },
    // local 锁定：同 type 下，数组中排在前面且 authMode=local 的实例存在
    localLocked() {
      const myIdx = this.allInstances.findIndex((x) => x.id === this.inst.id);
      if (myIdx < 0) return false;
      return this.allInstances.some(
        (o, idx) => idx < myIdx && o.type === this.localType && o.authMode === "local"
      );
    },
    effectiveAuthMode() {
      // 锁定时强制 manual
      return this.localLocked ? "manual" : this.inst.authMode;
    },
    curlPlaceholder() {
      return this.template?.curlHint || "粘贴完整 curl 命令";
    },
    curlHint() {
      return this.template?.curlHint || "从浏览器 DevTools -> Network -> 右键 Copy as cURL 粘贴到这里";
    },
    curl2Placeholder() {
      return this.template?.curl2Hint || "可选，粘贴第二个 curl 命令";
    },
    curl2Hint() {
      return this.template?.curl2Hint || "";
    },
    showCurl2() {
      return this.localType === "minimax";
    },
    // 登录态（从父组件传入的 loginStatus map 读取）
    loginChecking() {
      return this.loginStatus[this.inst.id]?.state === "checking";
    },
    loginOk() {
      return this.loginStatus[this.inst.id]?.state === "ok";
    },
    loginMiss() {
      return this.loginStatus[this.inst.id]?.state === "miss";
    },
    loginCount() {
      return this.loginStatus[this.inst.id]?.count || 0;
    },
    loginMessage() {
      return this.loginStatus[this.inst.id]?.message || "";
    },
  },
  watch: {
    // inst 变化时（如整体重渲）同步本地态
    inst: {
      handler(newVal) {
        this.localEnabled = newVal.enabled;
        this.localName = newVal.name;
        this.localType = newVal.type;
        this.localCurl = newVal.manualCurl || newVal.manualCookie || "";
        this.localCurl2 = newVal.manualCurl2 || "";
      },
      deep: true,
    },
  },
  methods: {
    // 收集当前卡片的字段，emit 给父组件写 storage
    collectFields() {
      return {
        id: this.inst.id,
        enabled: this.localEnabled,
        name: this.localName,
        type: this.localType,
        authMode: this.effectiveAuthMode,
        manualCurl: this.localCurl,
        manualCurl2: this.localCurl2,
      };
    },
    onFieldChange() {
      this.$emit("update", this.collectFields());
    },
    onTypeChange() {
      this.$emit("update", this.collectFields(), { reloadAll: true });
    },
    onAuthChange() {
      this.$emit("update", this.collectFields(), { reloadAll: true, checkLogin: this.effectiveAuthMode === "local" });
    },
    onDelete() {
      this.$emit("delete", this.inst.id, this.inst.name);
    },
    openLogin() {
      const url = this.template?.loginUrl;
      if (url) chrome.tabs.create({ url });
    },
  },
};
</script>

<style scoped>
.instance-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-inner);
  padding: 16px;
  margin-bottom: 12px;
  background: var(--color-bg-subtle);
}
.instance-card.disabled {
  opacity: 0.55;
}
.instance-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.instance-name-input {
  flex: 1;
}
.instance-name-input >>> .el-input__inner {
  font-weight: 600;
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
.field-input {
  flex: 1;
}
.auth-select-wrapper {
  flex: 1;
}
.login-status-row {
  align-items: center;
}
.login-status-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.login-status-text {
  font-size: 12px;
  font-weight: 500;
}
.login-checking { color: var(--color-text-tertiary); }
.login-ok { color: var(--color-ok); }
.login-miss { color: var(--color-warn); }
.login-unknown { color: var(--color-text-faint); }
.manual-cookie-row {
  margin-top: 4px;
}
.cookie-textarea >>> .el-textarea__inner {
  font-family: "SF Mono", "Menlo", "Monaco", "Consolas", monospace;
  font-size: 11.5px;
  line-height: 1.5;
  word-break: break-all;
}
.cookie-hint {
  font-size: 11px;
  color: var(--color-text-faint);
  margin-top: 5px;
  margin-bottom: 10px;
  line-height: 1.5;
}
.manual-cookie2-row {
  margin-top: 8px;
}
</style>
