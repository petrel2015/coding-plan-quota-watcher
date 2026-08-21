// dashboard 页 Vue 入口
import Vue from "vue";
import ElementUI from "element-ui";
import "element-ui/lib/theme-chalk/index.css";
import "../../element-overrides.css"; // Element-UI 深色模式覆盖（需在 element-ui CSS 之后）
import App from "./App.vue";
import { getLocale } from "../shared/i18n.js";
import elZhCN from "element-ui/lib/locale/lang/zh-CN";
import elEn from "element-ui/lib/locale/lang/en";

// Element UI 组件内置文案按当前语言加载（跟随浏览器语言）
Vue.use(ElementUI, { locale: getLocale() === "zh" ? elZhCN : elEn });
Vue.config.productionTip = false;

new Vue({
  render: (h) => h(App),
}).$mount("#app");
