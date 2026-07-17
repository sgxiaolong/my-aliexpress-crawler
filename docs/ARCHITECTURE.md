# 爬虫浏览器架构

## 浏览器运行方式

服务代码仍使用 `puppeteer-extra` 与 stealth 插件控制页面，但实际启动的是**系统 Chrome**，不是 Puppeteer 下载的 Chrome for Testing。

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `CRAWLER_CHROME_EXECUTABLE` | 自动探测系统 `chrome.exe` | 覆盖 Chrome 可执行文件。 |
| `CRAWLER_CHROME_PROFILE_DIR` | `./user_data_profile_puppeteer` | 独立采集登录态。 |
| `CRAWLER_CDP_PORT` | `9223` | 健康检查、排障及复用浏览器。 |
| `MAX_CONCURRENT_TABS` | `1` | 抓取并发标签数。 |

启动时先检查指定 Profile 中的 `DevToolsActivePort` 是否正好为 9223；满足则复用已有 Chrome，否则以 `--remote-debugging-port=9223 --start-minimized` 启动系统 Chrome。它只整理自己的 Profile 标签页，不会接触 8001 的 9222 店小秘浏览器。

## 会话与人工介入

Profile 和可选 `cookie.txt` / `cookie_csp.txt` 会在启动时恢复。服务仍保留 Cookie 更新 API 供兼容性或运维使用，但 5173 当前 UI 不再提供 Cookie 字符串输入。推荐直接在该 Chrome 窗口完成速卖通主站或 CSP 登录、验证码处理，再由 `/api/status` 和 5173 顶部状态确认。

`interactive_scraper.js`、`get_full_json.js` 等历史脚本可能仍使用旧 Profile 路径；它们不等于 HTTP 服务的登录态。
