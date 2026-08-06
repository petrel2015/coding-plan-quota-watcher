// dashboard.js - 全屏 dashboard 页面（共享协调器见 common.js）

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("settings-btn").addEventListener("click", () => {
    window.location.href = "settings.html";
  });

  QuotaApp.init({
    containerId: "sources",
    refreshAllBtnId: "refresh-all-btn",
    useDisplayCols: true,
    emptyText: "暂无启用的数据源，请到设置页面添加",
  });
});
