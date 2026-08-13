# Coding Plan Quota Watcher

[English](./README.md) | 中文

[![Version](https://img.shields.io/badge/version-1.8.0-blue.svg)](https://github.com/petrel2015/coding-plan-quota-watcher/releases)
[![Stars](https://img.shields.io/github/stars/petrel2015/coding-plan-quota-watcher?style=flat&color=yellow)](https://github.com/petrel2015/coding-plan-quota-watcher/stargazers)
[![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-MV3-4285F4.svg)](https://developer.chrome.com/docs/extensions/)
[![Vue 2](https://img.shields.io/badge/Vue-2.7-42b883.svg)](https://vuejs.org/)
[![Element UI](https://img.shields.io/badge/Element--UI-2.15-409EFF.svg)](https://element.eleme.io/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)
[![Tests](https://img.shields.io/badge/tests-vitest-green.svg)](./test)

---

一个 Chrome 浏览器扩展（Manifest V3），用于**统一监控多个 AI Coding Plan（编码套餐）的用量配额**。把分散在各个平台的用量信息集中到一个 Dashboard 面板里，不用逐个登录网站查"额度还剩多少"。

> **💡 核心目标：所有编码套餐用量集中在一个面板，一眼看清"还剩多少、何时重置"。**

---

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
- **主题三档**：亮色 / 暗色 / 跟随系统
- **自动刷新**：后台每 5 分钟拉取一次，也可手动单卡/全部刷新
- **重试与超时兜底**：转圈超过 5s 显示「点击重试」链接；超过 30s 判定超时并提示失败（杜绝永久转圈）
- **登录检测 + local 锁定**：本地 Cookie 实例实时反馈登录态；同类型数据源只有第一个能用本地 Cookie 鉴权（其余锁定为手动 cURL，防止分区 cookie 串用）
- **可调节列数**：Dashboard 支持 1/2/3 列布局

## 安装（从源码构建加载）

本扩展使用 Vite 打包，MV3 禁止远程 CDN 脚本，因此必须先构建再加载。

```bash
git clone https://github.com/petrel2015/coding-plan-quota-watcher.git
cd coding-plan-quota-watcher
npm install          # 安装依赖（Vue、Element-UI、Vite 等）
npm run build        # 打包到 dist/（settings/dashboard/background + Element-UI CSS/字体）
```

构建完成后：

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，**选择项目根目录**（不是 dist/，是整个项目根，manifest.json 所在处）
4. 扩展图标会出现在工具栏，**点击图标直接打开 Dashboard 面板**

> 改代码后只需 `npm run build` 再到 `chrome://extensions` 点扩展卡片上的「刷新」按钮即可。
> `build` 会自动先跑 `sync-version`（见下节），保证 manifest.json 版本号与 package.json 一致。

## 版本号管理

**单一真源**：`package.json` 的 `version` 字段。`manifest.json` 的 `version` 由脚本 `scripts/sync-version.mjs` 自动同步，**不要手动改 manifest.json 的版本号**。

发版推荐用 npm 内置命令（会同时改 package.json + 打 git tag）：

```bash
npm version patch   # 1.7.0 → 1.7.1（bug 修复）
npm version minor   # 1.7.0 → 1.8.0（新功能）
npm version major   # 1.7.0 → 2.0.0（破坏性变更）
```

`npm version` 执行时会先跑测试（`preversion` 钩子），通过后才改版本号并提交 + 打 tag。改完后用 `npm run package`（见下）产出该版本的 zip，然后 `git push --tags` 推 tag。

> 手动改版本号也可以，但改完 `package.json` 后务必跑 `npm run sync-version` 同步到 manifest.json；`npm run build` / `package` 也会自动同步。

## 打包成 Chrome 扩展

### 方式一：一键打包 zip（推荐）

```bash
npm run package
```

一条命令完成：同步版本号 → `vite build` → 打 zip 到 `releases/`。产物：

```
releases/coding-plan-quota-watcher-<version>.zip
```

zip 内容是**可加载的最小扩展包**（`manifest.json` + `dist/` 产物 + `icons/` + `*.html` + `common.css` + README 文件），自动排除 `node_modules/`、`.git/`、`src/`、`test/`、`*.pem`、`*.crx` 等开发文件。跨平台：macOS/Linux 用系统 `zip`，Windows 用自带的 `tar`。

**安装这个 zip**：

- **开发者模式加载**（内部/小范围分发）：解压 zip → `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选解压后的目录。
- **上架 Chrome 应用商店**：访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)，直接上传该 zip，填写商店信息后提交审核。

### 方式二：打包成 .crx（Chrome 内置，需私钥）

适合需要 `.crx` 二进制分发、且有固定私钥的场景：

1. 先 `npm run build`（确保 `dist/` 最新）
2. 打开 `chrome://extensions/`，开启「开发者模式」
3. 点击「打包扩展程序」
4. **扩展程序根目录**：填项目根目录路径（含 manifest.json 的目录，不是 dist/）
5. **私钥文件**：首次留空，Chrome 自动生成 `key.pem`（妥善保管，后续更新必须用同一个）
6. 点击「打包扩展程序」→ 在项目**上级目录**生成 `coding-plan-quota-watcher.crx` 和 `coding-plan-quota-watcher.pem`

> ⚠️ `.pem` 是扩展的身份凭证，**务必保管好且不要提交到 git**（已在 .gitignore 排除）。丢了就无法给同一个扩展发布更新，Chrome 会视为新扩展。

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
scripts/
├── sync-version.mjs   版本号同步：package.json → manifest.json
└── package.mjs        一键打包：sync-version + build + zip → releases/
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
releases/              打包产物（gitignore，npm run package 生成）
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
- **并发批量刷新**：`refreshAll` 用 `Promise.all` 并行拉取所有实例——每个请求分配唯一 DNR ruleId + `_qwid`，规则互不冲突，故可并发。单卡刷新与测试连接仍走 `serializeFetch` 串行锁。
- **storage 推送**：前端不轮询，通过 `chrome.storage.onChanged` 监听后台写入，Vue 响应式自动更新 DOM。
- **ES module 统一**：background service worker 用 `"type": "module"`，与页面共享 `src/shared/` 下的纯逻辑，无重复。

## 技术栈

- Chrome Extension Manifest V3
- Vue 2.7 + Element-UI 2.15（SFC，Vite 编译时模板编译）
- Vite 5（multi-entry 打包）
- vitest（单元测试）
