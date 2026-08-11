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
manifest.json          扩展清单（service_worker 指向 dist/background.js）
vite.config.js         Vite 构建配置（multi-entry）
common.css             共享设计 token（颜色/圆角/阴影，三档主题 CSS 变量）
element-overrides.css  Element-UI 组件深色模式覆盖
src/
├── settings/          settings 页（Vue 2 + Element-UI）
│   ├── main.js        Vue 入口
│   ├── App.vue        设置页根组件
│   └── InstanceCard.vue 数据源卡片组件
├── dashboard/         dashboard 页（Vue 2 + Element-UI）
│   ├── main.js        Vue 入口
│   ├── App.vue        仪表盘根组件
│   └── SourceCard.vue 用量卡片组件
├── background/        Service Worker
│   └── main.js        ES module：定时拉取、DNR 注入、消息分发
└── shared/            跨页面共享的 ES module
    ├── sources.js     数据源模板、默认配置、字段迁移
    ├── render.js      归一化 + 消耗预测
    ├── format.js      格式化工具（相对时间/倒计时/数字等）
    └── theme.js       主题三档切换
dashboard.html / settings.html  页面入口（引用 dist 产物）
test/                  单元测试（vitest）
dist/                  构建产物（gitignore，需 npm run build 生成）
```

### 开发流程

```bash
npm install           # 安装依赖
npm run build         # Vite 打包到 dist/（MV3 禁远程脚本，必须本地打包）
# 然后到 chrome://extensions → 加载已解压扩展程序 → 选项目根目录
# 改代码后重新 npm run build + 点扩展刷新
```

> MV3 扩展页 CSP 禁止远程 CDN 脚本和 `unsafe-eval`，因此 Vue/Element-UI 必须本地打包（Vite 编译时模板编译，规避运行时编译）。

### 运行测试

```bash
npm test            # 单次运行
npm run test:watch  # 监听模式
```

测试覆盖 `normalizeData`（四数据源归一化）、`migrateInstances`（字段迁移）、`generateInstanceName`（默认名字生成）。

### 架构说明

**数据流**：
```
平台 API → background SW（DNR 注入 cookie）→ storage.local → onChanged 事件 → Vue 响应式更新
```

**关键技术点**：
- **declarativeNetRequest (DNR)**：Service Worker 的 `fetch` 不带 cookie，需用 DNR 动态规则在请求发出前注入 `cookie` header。每个请求用唯一 `_qwid` 查询参数匹配规则，请求结束后立即清理。
- **串行刷新**：所有实例的拉取通过 `serializeFetch` 链式锁串行执行，避免 DNR 规则并发冲突。
- **storage 推送**：前端不轮询，通过 `chrome.storage.onChanged` 监听后台写入，Vue 响应式自动更新 DOM。
- **ES module 统一**：background service worker 用 `"type": "module"`，与页面共享 `src/shared/` 下的纯逻辑，无重复。

## 技术栈

- Chrome Extension Manifest V3
- Vue 2.7 + Element-UI 2.15（SFC，Vite 编译时模板编译）
- Vite 5（multi-entry 打包）
- vitest（单元测试）
