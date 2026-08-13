<template>
  <div class="instance-card" :class="{ disabled: !inst.enabled }">
    <!-- 第一行：开关 + 上移/下移/删除（名字移到「类型」下方独立一行） -->
    <div class="instance-row">
      <el-switch v-model="localEnabled" :disabled="false" @change="onFieldChange" />
      <div class="instance-row-actions">
        <el-button size="mini" :disabled="index === 0" @click="$emit('move', inst.id, -1)">↑</el-button>
        <el-button size="mini" :disabled="index === lastIndex" @click="$emit('move', inst.id, 1)">↓</el-button>
        <el-button size="mini" type="danger" plain @click="onDelete">{{ t('instance.delete') }}</el-button>
      </div>
    </div>

    <!-- 类型 -->
    <div class="field-row">
      <span class="field-label">{{ t('instance.type') }}</span>
      <el-select v-model="localType" @change="onTypeChange" class="field-input">
        <el-option v-for="(tmpl, key) in templates" :key="key" :label="t(tmpl.name)" :value="key" />
      </el-select>
    </div>

    <!-- 名称（在类型下方；类型变化时若用户未手动改过名，则自动跟随重命名） -->
    <div class="field-row">
      <span class="field-label">{{ t('instance.name') }}</span>
      <el-input
        v-model="localName"
        class="field-input instance-name-input"
        @blur="onNameBlur"
        @change="onNameChange"
      />
    </div>

    <!-- 鉴权（锁定时用 el-tooltip 包裹，悬浮提示原因；锁定态下点击 local 会弹 toast 说明） -->
    <div class="field-row">
      <span class="field-label">{{ t('instance.auth') }}</span>
      <el-tooltip
        :disabled="!localLocked"
        :content="t('instance.lockTip')"
        placement="top"
      >
        <div class="auth-select-wrapper">
          <el-select
            v-model="effectiveAuthMode"
            :disabled="localLocked"
            class="field-input"
            @change="onAuthChange"
          >
            <el-option :label="t('instance.authLocal')" value="local" />
            <el-option :label="t('instance.authManual')" value="manual" />
          </el-select>
        </div>
      </el-tooltip>
    </div>

    <!-- local 模式：登录态检测 -->
    <div v-if="effectiveAuthMode === 'local'" class="field-row login-status-row">
      <span class="field-label">{{ t('instance.status') }}</span>
      <div class="login-status-content">
        <span v-if="loginChecking" class="login-status-text login-checking">{{ t('instance.checking') }}</span>
        <span v-else-if="loginOk" class="login-status-text login-ok">
          {{ t('instance.loginOk', { count: loginCount }) }}
        </span>
        <template v-else-if="loginMiss">
          <span class="login-status-text login-miss">{{ t('instance.loginMiss') }}</span>
          <el-button size="mini" type="primary" @click="openLogin">{{ t('instance.loginNow') }}</el-button>
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
          <span class="field-label">{{ t('instance.curl2') }}</span>
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

    <!-- 测试连接：真实请求一次，验证鉴权/网络是否可用 -->
    <div class="field-row test-row">
      <span class="field-label">{{ t('instance.verify') }}</span>
      <div class="test-content">
        <el-button
          size="mini"
          :disabled="testing"
          @click="onTestConnection"
        >{{ testing ? t('instance.testing') : t('instance.testConn') }}</el-button>
        <span v-if="testState === 'ok'" class="test-text test-ok">{{ t('instance.testOk') }}</span>
        <template v-else-if="testState === 'fail' && testDiag">
          <span class="test-text test-fail">{{ testDiag.title }}</span>
          <span class="test-advice">{{ testDiag.advice }}</span>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { SOURCE_TEMPLATES, generateInstanceName } from "../shared/sources.js";
import { t } from "../shared/i18n.js";

export default {
  name: "InstanceCard",
  props: {
    inst: { type: Object, required: true },
    allInstances: { type: Array, default: () => [] },
    index: { type: Number, default: 0 },
    lastIndex: { type: Number, default: 0 },
    loginStatus: { type: Object, default: () => ({}) },
    testResult: { type: Object, default: () => ({}) },
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
      // 鉴权模式本地编辑态（v-model 绑它；锁定时 effectiveAuthMode 强制 manual）
      localAuthMode: this.inst.authMode || "manual",
      // 用户是否手动改过名：false=名字跟随类型自动生成，true=类型变化时保持不动
      localNameCustomized: this.inst.nameCustomized === true,
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
      // 锁定时强制 manual；否则用本地编辑态
      return this.localLocked ? "manual" : this.localAuthMode;
    },
    curlPlaceholder() {
      const k = this.template?.curlHint;
      return k ? t(k) : t("instance.curlPlaceholder");
    },
    curlHint() {
      const k = this.template?.curlHint;
      return k ? t(k) : t("instance.curlHintFallback");
    },
    curl2Placeholder() {
      const k = this.template?.curl2Hint;
      return k ? t(k) : t("instance.curl2Placeholder");
    },
    curl2Hint() {
      const k = this.template?.curl2Hint;
      return k ? t(k) : "";
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
    // 测试连接结果（从父组件传入的 testResult map 读取）
    testing() {
      return this.testResult[this.inst.id]?.state === "testing";
    },
    testState() {
      return this.testResult[this.inst.id]?.state || "";
    },
    testDiag() {
      return this.testResult[this.inst.id]?.diag || null;
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
        this.localAuthMode = newVal.authMode || "manual";
        this.localNameCustomized = newVal.nameCustomized === true;
      },
      deep: true,
    },
    // 锁定态变化时（如上方同类型卡改了 authMode），把本地态同步到锁定后的有效值
    localLocked() {
      this.localAuthMode = this.effectiveAuthMode;
    },
  },
  methods: {
    t,
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
        nameCustomized: this.localNameCustomized,
      };
    },
    onFieldChange() {
      this.$emit("update", this.collectFields());
    },
    // 类型变化：若用户未手动改过名（localNameCustomized=false），
    // 名字自动跟随新类型重生成（如 MiniMax Token Plan → 智谱 GLM 用量 / #2）。
    // 用户改过名则保持不变。
    onTypeChange() {
      if (!this.localNameCustomized) {
        this.localName = generateInstanceName(this.localType, this.allInstances, this.inst.id);
      }
      this.$emit("update", this.collectFields(), { reloadAll: true });
    },
    // 名称输入：用户手动改动后标记为已自定义，之后类型变化不再覆盖
    onNameChange() {
      // el-input @change 在内容相对上次确有变化时触发；置标志 + 持久化
      this.localNameCustomized = true;
      this.$emit("update", this.collectFields());
    },
    // blur：若用户没改过（change 未触发），仅持久化；与原来行为一致
    onNameBlur() {
      this.onFieldChange();
    },
    onAuthChange(newMode) {
      // 锁定态下用户尝试切 local：显示值由 effectiveAuthMode 强制为 manual，
      // 这里把被 v-model 写脏的 localAuthMode 还原，并弹 toast 说明原因（原本只闪一下无提示）
      if (this.localLocked && newMode === "local") {
        this.localAuthMode = "manual";
        this.$emit("auth-blocked", {
          id: this.inst.id,
          reason: t("instance.authBlockedReason"),
        });
        return;
      }
      // 非锁定态：localAuthMode 已被 v-model 更新为 newMode，这里持久化即可
      this.$emit("update", this.collectFields(), { reloadAll: true, checkLogin: this.effectiveAuthMode === "local" });
    },
    onDelete() {
      this.$emit("delete", this.inst.id, this.inst.name);
    },
    openLogin() {
      const url = this.template?.loginUrl;
      if (url) chrome.tabs.create({ url });
    },
    // 测试连接：把当前卡片的最新字段（含本地编辑态）发给父组件，由父组件调 background 真实请求
    onTestConnection() {
      this.$emit("test-connection", this.collectFields());
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
.instance-row-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
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
/* 测试连接行 */
.test-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.test-text {
  font-size: 12px;
  font-weight: 500;
}
.test-ok { color: var(--color-ok); }
.test-fail { color: var(--color-danger); }
.test-advice {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.45;
  flex-basis: 100%;
}
</style>
