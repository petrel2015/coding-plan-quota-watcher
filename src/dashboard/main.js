// dashboard 页 Vue 入口
import Vue from "vue";
import ElementUI from "element-ui";
import "element-ui/lib/theme-chalk/index.css";
import "../../element-overrides.css"; // Element-UI 深色模式覆盖（需在 element-ui CSS 之后）
import App from "./App.vue";

Vue.use(ElementUI);
Vue.config.productionTip = false;

new Vue({
  render: (h) => h(App),
}).$mount("#app");
