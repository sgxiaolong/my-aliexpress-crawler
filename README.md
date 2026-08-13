# my-aliexpress-crawler

速卖通商品与 CSP 信息抓取服务。生产集成由 15173 调用，通常监听 `15174`；独立运行时默认端口仍是 `3000`。默认仅监听 `127.0.0.1`；如需跨机器调用，必须显式设置 `CRAWLER_HOST=0.0.0.0`，并同时配置服务认证和防火墙/IP 白名单。登录态只由 crawler 自己管理的 Chrome Profile 和本地 Cookie 文件恢复，不接收 controller 或其他调用方传入的 Cookie。

```powershell
npm install
$env:PORT='15174'
npm run serve
```

服务启动时使用系统 Chrome、独立 Profile `user_data_profile_puppeteer/` 和 CDP `9223`。浏览器最小化打开商品示例页与 CSP 示例页，便于人工登录或处理验证码，但不会抢占前台。详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/API_REFERENCE.md](docs/API_REFERENCE.md)。
