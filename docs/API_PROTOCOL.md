# AliExpress Scraper 中台客户端 (5174/5173) 与 后端微服务 (3000) 通信协议规范

本文档详述前端可视化控制中台 (`crawler-upload-controller`) 与后端爬虫接口微服务 (`my-aliexpress-crawler`) 之间的 **HTTP JSON RESTful 通信报文协议**。

---

## 1. 抓取商品数据接口 (Scrape API)

* **接口路径**：`GET /api/scrape?id={productId}` 或 `POST /api/scrape`
* **协议类型**：HTTP / RESTful JSON
* **支持方法**：GET, POST

### 请求协议报文 (Request Payload - POST JSON)
```json
{
  "id": "1005007856985898",
  "cookie": "可选传入实时临时 Cookie 字符串"
}
```

### 响应协议报文 - 抓取成功 (HTTP 200 OK)
```json
{
  "success": true,
  "mode": "Browser-Tab-Pool (Plan A)",
  "timestamp": "2026-07-08T18:00:00.000Z",
  "data": {
    "productId": "1005007856985898",
    "title": "速卖通商品名称...",
    "price": "US $12.99",
    "originalPrice": "US $25.98",
    "currency": "USD",
    "mainImage": "https://ae01.alicdn.com/kf/...",
    "skuList": [
      {
        "skuId": "120000301...",
        "skuName": "Color: Black",
        "price": "US $12.99",
        "stock": 100
      }
    ],
    "reviews": []
  }
}
```

### 响应协议报文 - 会话失效/滑块拦截 (HTTP 401 Unauthorized)
```json
{
  "success": false,
  "error_code": "COOKIE_EXPIRED_OR_BLOCKED",
  "message": "速卖通会话已失效、触发人机验证或转跳登录，请更新 Cookie 后重试",
  "action_required": "RENEW_COOKIE",
  "details": "拉取商品 1005007856985898 失败：页面标题[] 会话可能已过期转跳登录或遭遇人机滑块拦截..."
}
```

---

## 2. Cookie 零停机热更新接口 (Update Cookie API)

* **接口路径**：`POST /api/cookie/update`
* **应用场景**：当抓取商品触发 401 报错时，客户端通过该接口实时推送到常驻 Chromium 浏览器内。

### 请求协议报文 (Request JSON Payload)
```json
{
  "cookie": "aead_id=xxx; xman_f=yyy; ali_apache_id=zzz; cna=..."
}
```

### 响应协议报文 (HTTP 200 OK)
```json
{
  "success": true,
  "message": "Cookie 热更新成功，常驻 Chrome 进程已立刻生效，共载入 18 个字段",
  "cookie_count": 18
}
```

---

## 3. 服务健康状态心跳接口 (Health Check API)

* **接口路径**：`GET /api/status`

### 响应协议报文 (HTTP 200 OK)
```json
{
  "success": true,
  "service": "AliExpress Scraper HTTP API (Plan A - Tab Pool)",
  "status": "healthy",
  "active_tabs": 1,
  "max_concurrent_tabs": 5,
  "profile_status": {
    "cookie_file_exists": true,
    "user_data_profile_exists": true
  }
}
```
