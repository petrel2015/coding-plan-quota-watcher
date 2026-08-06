// popup.js - 弹窗逻辑（共享协调器见 common.js）

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("dashboard-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });

  QuotaApp.init({
    containerId: "sources",
    refreshAllBtnId: "refresh-btn",
    emptyText: "暂无数据源，请到设置页面添加",
  });
});
