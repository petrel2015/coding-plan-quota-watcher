# Coding Plan Quota Watcher

一个 Chrome 浏览器扩展（Manifest V3），用于**统一监控多个 AI Coding Plan（编码套餐）的用量配额**。把分散在各个平台的用量信息集中到一个 Dashboard 面板里，不用逐个登录网站查"额度还剩多少"。

## 支持的数据源

| 数据源 | 平台 | 监控内容 |
|--------|------|----------|
| **火山方舟 Agent Plan** | console.volcengine.com | 5 小时 / 周 / 月三个滚动窗口 |
| **MiniMax Token Plan** | platform.minimaxi.com | 小时窗口 + 周窗口 |
| **ChatGPT Codex** | chatgpt.com | 周窗口 + 次级窗口 + Credits + 重置预测 |
| **智谱 GLM** | bigmodel.cn | 5 小时窗口 + 周窗口 |

## 功能特性

- **多平台聚合**：一个面板查看所有套餐用量
- **进度条 + 三色预警**：绿（<70%）/ 黄（70-90%）/ 红（≥90%）
- **重置倒计时**：实时显示各窗口距离重置还剩多久
- **消耗速度预测**：按当前消耗速度线性外推，预测"预计何时用尽，是否比重置早"
- **深色模式**：跟随系统主题自动切换
- **自动刷新**：后台每 5 分钟拉取一次，也可手动单卡/全部刷新
- **可调节列数**：Dashboard 支持 1/2/3 列布局

## 安装

1. 下载本仓库代码
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目根目录
5. 扩展图标会出现在工具栏，**点击图标直接打开 Dashboard 面板**

## 配置数据源

点击 Dashboard 右上角「设置」按钮进入配置页。

### 鉴权方式（二选一）

**方式一：本地 Cookie（自动）**
- 在浏览器里正常登录对应平台即可
- 扩展会通过 `chrome.cookies` API 自动读取登录态
- 适用于 cookie 未被分区隔离的场景

**方式二：手动粘贴 cURL**
- 打开对应平台用量页
- F12 打开 DevTools → Network 标签
- 刷新页面，找到用量请求（各平台的请求名见下表）
- 右键该请求 → Copy → **Copy as cURL**
- 粘贴到设置页对应卡片的 `curl` 输入框
- 适用于 cookie 分区隔离导致自动模式失效的场景

| 平台 | Network 里要找的请求 |
|------|---------------------|
| 火山方舟 | `GetAgentPlanAFPUsage` |
| MiniMax | `remains_percent`（+ 可选 `consumption_records` 获取套餐名） |
| ChatGPT | `wham/usage` |
| 智谱 GLM | `quota/limit` |

## 开发

### 项目结构

```
manifest.json      扩展清单
background.js      Service Worker：定时拉取、DNR 注入、消息分发
sources.js         数据源模板（URL/header/cookie 配置，单一来源）
render.js          共享渲染：归一化 + 进度条 + 消耗预测
common.js          Dashboard 渲染协调器 + 工具函数
common.css         共享样式（卡片、进度条、深色模式）
dashboard.html/js  全屏 Dashboard 页面
settings.html/js   数据源配置页（增删改、鉴权切换、排序）
test/              单元测试（vitest）
```

### 运行测试

```bash
npm install
npm test            # 单次运行
npm run test:watch  # 监听模式
```

测试覆盖 `normalizeData`（四数据源归一化）和 `migrateInstances`（字段迁移）这两个纯函数。

### 架构说明

**数据流**：
```
平台 API → background.js（DNR 注入 cookie）→ storage.local → onChanged 事件 → Dashboard 卡片
```

**关键技术点**：
- **declarativeNetRequest (DNR)**：Service Worker 的 `fetch` 不带 cookie，需用 DNR 动态规则在请求发出前注入 `cookie` header。每个请求用唯一 `_qwid` 查询参数匹配规则，请求结束后立即清理。
- **串行刷新**：所有实例的拉取通过 `serializeFetch` 链式锁串行执行，避免 DNR 规则并发冲突。
- **storage 推送**：前端不轮询，通过 `chrome.storage.onChanged` 监听后台写入，实现近实时更新。

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript（无框架、无构建步骤）
- vitest（单元测试）
