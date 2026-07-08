# AliExpress Scraper Microservice (`my-aliexpress-crawler`)

生产级智能速卖通抓取微服务，采用“**主业务工程 + 官方库 Git 子模块**”分层架构，具备常驻 HTTP API 服务、零停机 Cookie 热更新、401 凭证过期智能通知以及人工交互验证辅助工具。

---

## 📚 详细开发文档

* [**HTTP API 接口参考文档 (`docs/API_REFERENCE.md`)**](./docs/API_REFERENCE.md)
  * 包含 `/api/scrape` 抓取规范、`/api/cookie/update` 凭证热更新规范、401 异常自愈协议及 Python / cURL 调用代码示例。
* [**微服务架构与设计说明 (`docs/ARCHITECTURE.md`)**](./docs/ARCHITECTURE.md)
  * 阐述主工程与开源 Submodule 零侵入协作原理、Chromium SQLite Cookie 固化机制和自动化自愈闭环架构图。

---

## 🚀 快速启动手册

### 1. 启动 HTTP 抓取微服务（推荐用于跨系统对接）

```bash
cd d:\SmtProject\my-aliexpress-crawler
npm run serve
# 或 node server.js
```
服务默认监听于 `http://localhost:3000`。

### 2. 人工辅助过人机滑块与凭证固化脚本

如果首次使用或需要人工划走验证码并固化 Profile 会话：

```bash
npm run interactive
# 或 node interactive_scraper.js <商品ID>
```

### 3. CLI 命令行单次抓取脚本

```bash
npm start
# 或 node get_full_json.js <商品ID>
```
