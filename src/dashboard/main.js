// dashboard 页 Vue 入口
import Vue from "vue";
import ElementUI from "element-ui";
import "element-ui/lib/theme-chalk/index.css";
import "../../element-overrides.css"; // Element-UI 深色模式覆盖（需在 element-ui CSS 之后）
import App from "./App.vue";
import { getLocale, applyStoredLocale } from "../shared/i18n.js";
import elZhCN from "element-ui/lib/locale/lang/zh-CN";
import elEn from "element-ui/lib/locale/lang/en";

// Element UI 组件文案在 Vue.use 时一次性绑定，须先异步恢复用户选择的语言
async function boot() {
  await applyStoredLocale();
  Vue.use(ElementUI, { locale: getLocale() === "zh" ? elZhCN : elEn });
  Vue.config.productionTip = false;

  new Vue({
    render: (h) => h(App),
  }).$mount("#app");
}
boot();
