# 速卖通抓取微服务 HTTP API 开发文档 (API Reference)

本文档面向调用方（后端服务、Python 脚本、微服务编排系统等），详细介绍 `my-aliexpress-crawler` HTTP 服务的接口规范、会话生命周期处理与各类代码调用示例。

---

## 快速概览

* **服务默认基础 URL**: `http://localhost:3000`
* **传输协议**: HTTP / RESTful JSON
* **数据编码**: `UTF-8`

| 接口说明 | 请求方式 | 接口路径 | 核心返回值 |
| :--- | :--- | :--- | :--- |
| **商品核心 JSON 数据采集** | `GET` / `POST` | `/api/scrape` | `200 OK` (商品 JSON) / `401` (Cookie 过期需续期) |
| **Cookie 零停机热更新** | `POST` | `/api/cookie/update` | `200 OK` (成功解析字段数) |
| **服务健康与凭证就绪状态** | `GET` | `/api/status` | `200 OK` (实时并发与 Profile 检查) |

---

## 1. 商品核心数据采集接口 `/api/scrape`

根据传入的速卖通商品 ID 自动在服务器后台通过 Puppeteer 浏览器采集数据，返回官方规范化格式的 JSON。

### 请求方式

支持 `GET` 和 `POST` 两种形式：

* **GET 请求示例**：
  ```http
  GET /api/scrape?id=1005007856985898 HTTP/1.1
  Host: localhost:3000
  ```

* **POST 请求示例**：
  ```http
  POST /api/scrape HTTP/1.1
  Host: localhost:3000
  Content-Type: application/json

  {
    "id": "1005007856985898",
    "cookie": "可选参数：如果传递将针对本次或后续请求动态载入"
  }
  ```

### 参数说明

| 参数名 | 必传 | 类型 | 说明 |
| :--- | :--- | :--- | :--- |
| `id` (或 `productId`) | 是 | `string` | 速卖通商品详情页的数值 ID，例如 `1005007856985898` |
| `cookie` | 否 | `string` | 可选传入新 Cookie 字符串，服务接收后会自动更新至本地会话凭证文件 |

---

### 响应说明

#### 1) 成功响应 (`HTTP 200 OK`)

```json
{
  "success": true,
  "timestamp": "2026-07-08T09:00:00.000Z",
  "data": {
    "id": "1005007856985898",
    "title": "Aliexpress Product Official Title...",
    "categoryName": "Home & Garden",
    "mainImage": "https://ae01.alicdn.com/kf/...",
    "skus": [
      {
        "skuId": "12000030001",
        "price": "12.99",
        "stock": 100
      }
    ],
    "reviews": [ ... ],
    "description": "<html>...</html>"
  }
}
```

#### 2) Cookie 失效 / 被风控拦截 (`HTTP 401 Unauthorized`)

当会话过期、触发人机滑块或重定向至登录页时，返回结构化告警：

```json
{
  "success": false,
  "error_code": "COOKIE_EXPIRED_OR_BLOCKED",
  "message": "速卖通会话已失效、被安全拦截或超时，请更新 Cookie 凭证后重试",
  "action_required": "RENEW_COOKIE",
  "details": "Page navigation timeout or redirect to login.aliexpress.com"
}
```

> **最佳实践指南**：上层系统监听到 HTTP `401` 或 `error_code == "COOKIE_EXPIRED_OR_BLOCKED"` 时，应立即启动 Cookie 续期流程或调用 `/api/cookie/update` 推送新凭证。

#### 3) 并发限制触发 (`HTTP 429 Too Many Requests`)

为保护主机 CPU 与内存，超出设定并发阈值（默认 3）时提示：

```json
{
  "success": false,
  "error_code": "TOO_MANY_REQUESTS",
  "message": "当前并发抓取任务已达到上限 (3)，请稍后重试"
}
```

---

## 2. Cookie 零停机热更新接口 `/api/cookie/update`

上层客户端无需重启 Node 服务，即时将最新的 Cookie 字符串或头信息通过此接口推入服务，立即覆盖并在下一轮抓取任务中生效。

### 请求方式

```http
POST /api/cookie/update HTTP/1.1
Host: localhost:3000
Content-Type: application/json

{
  "cookie": "aead_id=xxx; xman_f=yyy; ali_apache_id=zzz; ..."
}
```

### 响应示例 (`HTTP 200 OK`)

```json
{
  "success": true,
  "message": "Cookie 热更新成功，共加载 18 个 Cookie 字段",
  "cookie_count": 18
}
```

---

## 3. 服务健康状态接口 `/api/status`

用于上层系统做容器心跳检测、就绪检查和性能监控。

### 响应示例 (`HTTP 200 OK`)

```json
{
  "success": true,
  "service": "AliExpress Scraper HTTP API",
  "status": "healthy",
  "active_scrapes": 1,
  "max_concurrent": 3,
  "profile_status": {
    "cookie_file_exists": true,
    "user_data_profile_exists": true
  }
}
```

---

## 4. 调用示例 (Python & cURL)

### Python 调用示例（包含 401 自动检测逻辑）

```python
import requests

API_URL = "http://localhost:3000/api/scrape"
PRODUCT_ID = "1005007856985898"

def fetch_product_data(product_id):
    response = requests.get(API_URL, params={"id": product_id})
    
    # 检测正常返回
    if response.status_code == 200:
        json_resp = response.json()
        return json_resp["data"]
        
    # 检测 Cookie 是否过期或被风控
    elif response.status_code == 401:
        err_info = response.json()
        print(f"⚠️ 警告: 会话凭证已过期！操作要求: {err_info.get('action_required')}")
        # 在此处可调起账号更新服务或企业微信通知管理员
        raise Exception("PLEASE_RENEW_COOKIE")
        
    else:
        raise Exception(f"请求失败: {response.status_code} - {response.text}")

if __name__ == "__main__":
    product = fetch_product_data(PRODUCT_ID)
    print("成功获取标题:", product["title"])
```
