# 爬虫 API 参考

基础地址取决于 `PORT`；项目联调通常是 `http://127.0.0.1:5174/api`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/status` | 浏览器和主站/CSP 会话状态。 |
| `POST` | `/scrape` | 按商品 ID 或 URL 抓取商品 JSON。 |
| `POST` | `/scrape/csp-attrs` | 查询/抓取 CSP 属性信息。 |
| `POST` | `/cookie/update` | 更新主站 Cookie（兼容 API）。 |
| `POST` | `/cookie/csp/update` | 更新 CSP Cookie（兼容 API）。 |

`/status` 除浏览器状态外还包含商品页与 CSP 页面会话状态。5173 读取这些状态展示“商品页可采集”“CSP 后台已登录”等提示；当出现登录或验证码时，应在服务打开的 Chrome 中人工处理。

采集服务不负责保存 5173 商品工作区，也不保证 CSP 一定可登录。CSP 数据缺失时，上游会使用商品 JSON 的类目兜底。
