# my-aliexpress-crawler

速卖通商品与 CSP 信息抓取服务。生产集成由 5173 调用，通常监听 `5174`；独立运行时默认端口仍是 `3000`。

```powershell
npm install
$env:PORT='5174'
npm run serve
```

服务启动时使用系统 Chrome、独立 Profile `user_data_profile_puppeteer/` 和 CDP `9223`。浏览器最小化打开商品示例页与 CSP 示例页，便于人工登录或处理验证码，但不会抢占前台。详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/API_REFERENCE.md](docs/API_REFERENCE.md)。
