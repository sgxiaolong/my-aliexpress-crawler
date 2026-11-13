# my-aliexpress-crawler

商品详情、竞价属性、评价等速卖通上游请求与返回协议统一见 [速卖通接口协议索引](../../Flask/docs/业务模块/速卖通接口/README.md)。新增或修改上游接口必须同批维护，具体要求见 `AGENTS.md`；本服务向外提供的 HTTP API 仍查阅 `docs/API_REFERENCE.md`。

速卖通商品与 CSP 信息抓取服务。生产集成由 15173 调用，通常监听 `15174`；独立运行时默认端口仍是 `3000`。默认仅监听 `127.0.0.1`；如需跨机器调用，必须显式设置 `CRAWLER_HOST=0.0.0.0`，并同时配置服务认证和防火墙/IP 白名单。登录态只由 crawler 自己管理的 Chrome Profile 和本地 Cookie 文件恢复，不接收 controller 或其他调用方传入的 Cookie。

```powershell
git submodule update --init --recursive
npm ci
$env:PORT='15174'
npm start
```

依赖版本由本仓库的 `package-lock.json` 和 Git 记录的 `libs/aliexpress-product-scraper` 子模块提交共同固定。首次安装、重新安装或更新代码后都使用 `npm ci`，不要删除锁文件重新解析版本；只有主动新增或升级依赖时才使用 `npm install` 并一起维护 `package.json` 和锁文件。其他运行数据 JSON 仍被忽略。

内嵌采集库声明要求 Node.js 24 或以上，安装环境应符合该要求。本机已有的 Node 22 不会因本次锁定自动升级。服务使用系统 Chrome；安装前可设置 `$env:PUPPETEER_SKIP_DOWNLOAD='true'`，避免 Puppeteer 另行下载浏览器。

`npm start` 与 `npm run serve` 均启动 HTTP 服务。历史独立采集脚本已退役，已有 Profile、Cookie 和采集数据保留。

服务启动时使用系统 Chrome、独立 Profile `user_data_profile_puppeteer/` 和 CDP `9223`。浏览器最小化打开商品示例页与 CSP 示例页，便于人工登录或处理验证码，但不会抢占前台。详情见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 和 [docs/API_REFERENCE.md](docs/API_REFERENCE.md)。
