# 爬虫浏览器架构

## 浏览器运行方式

服务代码仍使用 `puppeteer-extra` 与 stealth 插件控制页面，但实际启动的是**系统 Chrome**，不是 Puppeteer 下载的 Chrome for Testing。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `CRAWLER_CHROME_EXECUTABLE` | 自动探测系统 `chrome.exe` | 覆盖 Chrome 可执行文件。 |
| `CRAWLER_CHROME_PROFILE_DIR` | `./user_data_profile_puppeteer` | 独立采集登录态。 |
| `CRAWLER_CDP_PORT` | `9223` | 健康检查、排障及复用浏览器。 |
| `MAX_CONCURRENT_TABS` | `1` | 抓取并发标签数。 |

启动时先检查指定 Profile 中的 `DevToolsActivePort` 是否正好为 9223；满足则复用已有 Chrome，否则以 `--remote-debugging-port=9223 --start-minimized` 启动系统 Chrome。它只整理自己的 Profile 标签页，不会接触 18001 的 9222 店小秘浏览器。

## 会话与人工介入

Profile 和可选 `cookie.txt` / `cookie_csp.txt` 会在启动时恢复。服务不提供 Cookie 字符串更新 API；应直接在该 Chrome 窗口完成速卖通主站或 CSP 登录、验证码处理，再由 `/api/status` 和 15173 顶部状态确认。

历史独立采集脚本已退役，`npm start` 与 `npm run serve` 统一启动 `server.js`。旧 `user_data_profile/` 及其 Cookie、采集数据保留，但不等于当前 HTTP 服务的登录态。
