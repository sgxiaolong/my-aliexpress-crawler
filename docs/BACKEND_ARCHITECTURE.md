# 爬虫后端架构

```text
Express /api
  ├─ status routes：浏览器、商品页和 CSP 会话状态
  ├─ scrape routes：商品抓取、CSP 属性/活动信息
  └─ cookie routes：兼容性 Cookie 更新接口
                 │
                 ▼
puppeteer-extra → 系统 Chrome (Profile + CDP 9223)
                 │
                 ├─ 商品页 DOM、详情 API、描述和评论
                 └─ CSP 页面/API（含拦截的竞价信息）
```

`tabScraper.js` 负责常驻浏览器单例、系统 Chrome 探测/启动、两套会话恢复和启动页面。抓取结果返回给调用方；业务商品 JSON 由 5173 保存，不由本服务写入 `crawler-upload-controller/storage/`。

默认端口为 `3000`，但项目联调使用 `PORT=5174`，5173 的默认 `CRAWLER_BASE_URL` 也指向 `http://127.0.0.1:5174`。
