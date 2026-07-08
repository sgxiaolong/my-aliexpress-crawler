import express from "express";
import fs from "fs";
import {
  scrapeWithTab,
  injectCookieIntoBrowser,
  getPersistentBrowser,
  closePersistentBrowser,
} from "./utils/tabScraper.js";
import { normalizeCookies } from "./utils/cookieUtils.js";

const app = express();
const PORT = process.env.PORT || 3000;
const USER_DATA_DIR = "./user_data_profile";
const COOKIE_FILE = "./cookie.txt";

app.use(express.json({ limit: "10mb" }));

// 打印前端中台与后端微服务之间的 JSON HTTP 通信协议报文
app.use((req, res, next) => {
  if (req.path === "/api/status") return next(); // 心跳不重复刷屏
  console.log(`\n=================== 📡 [客户端 ${req.method()} ${req.url}] ===================`);
  if (Object.keys(req.body || {}).length > 0) {
    console.log("📥 请求 JSON 报文 Payload:", JSON.stringify(req.body, null, 2));
  }
  const oldJson = res.json;
  res.json = function (body) {
    console.log(`📤 [后端返回 HTTP ${res.statusCode}] JSON 通信报文:`);
    const previewBody = JSON.parse(JSON.stringify(body));
    if (previewBody.data && typeof previewBody.data === "object") {
      console.log(`   { success: ${previewBody.success}, mode: "${previewBody.mode}", ...产品摘要结构已封装 }`);
    } else {
      console.log("  ", JSON.stringify(previewBody, null, 2));
    }
    console.log("=========================================================================");
    return oldJson.call(this, body);
  };
  next();
});

// 方案 A 并发控制器：控制同一 Chrome 浏览器内部的最大并行标签页 (Tab) 数量
let activeTabs = 0;
const MAX_CONCURRENT_TABS = 5; // 支持同时开启 5 个并发网页标签页拉取数据

/**
 * 辅助函数：判断错误信息是否属于 Cookie 过期或触发速卖通风控拦截
 */
const isCookieExpiredOrBlockedError = (err) => {
  if (!err) return false;
  const msg = (err.message || err.toString()).toLowerCase();
  return (
    msg.includes("login") ||
    msg.includes("sec.aliexpress.com") ||
    msg.includes("slider") ||
    msg.includes("punish") ||
    msg.includes("validate") ||
    msg.includes("403") ||
    msg.includes("401") ||
    msg.includes("timeout")
  );
};

/**
 * 1. 抓取接口：GET /api/scrape?id=1005007856985898 或 POST /api/scrape
 *    使用“常驻浏览器 + 多标签页 (Tab) 池”实现真正的高性能并发抓取
 */
const handleScrape = async (req, res) => {
  const id = req.query.id || req.body?.id || req.body?.productId;
  const customCookie = req.headers["x-ali-cookie"] || req.body?.cookie;

  if (!id) {
    return res.status(400).json({
      success: false,
      error_code: "MISSING_PRODUCT_ID",
      message: "请提供必须的商品 ID 参数 (id 或 productId)",
    });
  }

  if (activeTabs >= MAX_CONCURRENT_TABS) {
    return res.status(429).json({
      success: false,
      error_code: "TOO_MANY_REQUESTS",
      message: `当前并发抓取网页标签页已达到上限 (${MAX_CONCURRENT_TABS} Tabs)，请稍后或缓冲重试`,
    });
  }

  // 如果请求带了新的临时 Cookie，同步注入到常驻浏览器的活动会话中
  if (customCookie && typeof customCookie === "string") {
    fs.writeFileSync(COOKIE_FILE, customCookie.trim(), "utf-8");
    await injectCookieIntoBrowser(customCookie.trim());
    console.log(`🍪 [API] 已立即向常驻浏览器实时会话中注入最新 Cookie！`);
  }

  activeTabs++;
  console.log(
    `🚀 [API-TabPool] 打开新标签页抓取商品 ID: ${id} (当前并行 Tabs 数: ${activeTabs}/${MAX_CONCURRENT_TABS})`
  );

  try {
    // 调用方案 A 多标签页抓取内核
    const productData = await scrapeWithTab(id, {
      reviewsCount: 10,
    });

    activeTabs--;
    console.log(`✅ [API-TabPool] 商品 ID: ${id} 数据采集完毕，标签页已关闭！`);

    return res.status(200).json({
      success: true,
      mode: "Browser-Tab-Pool (Plan A)",
      timestamp: new Date().toISOString(),
      data: productData,
    });
  } catch (err) {
    activeTabs--;
    console.error(`❌ [API-TabPool] 商品 ID: ${id} 抓取失败:`, err.message);

    if (isCookieExpiredOrBlockedError(err)) {
      return res.status(401).json({
        success: false,
        error_code: "COOKIE_EXPIRED_OR_BLOCKED",
        message: "速卖通会话已失效、触发人机验证或转跳登录，请更新 Cookie 后重试",
        action_required: "RENEW_COOKIE",
        details: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      error_code: "SCRAPE_FAILED",
      message: err.message || "抓取商品数据失败",
    });
  }
};

app.get("/api/scrape", handleScrape);
app.post("/api/scrape", handleScrape);

/**
 * 2. Cookie 零停机热更新接口：POST /api/cookie/update
 *    更新硬盘文件同时立刻注入已启动运行的常驻 Chrome 浏览器
 */
app.post("/api/cookie/update", async (req, res) => {
  const { cookie } = req.body;
  if (!cookie || typeof cookie !== "string") {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_COOKIE",
      message: "请求参数中必须包含字符串类型的 cookie 字段",
    });
  }

  const normalized = normalizeCookies(cookie);
  if (normalized.length === 0) {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_COOKIE_FORMAT",
      message: "无法解析出有效的速卖通 Cookie 键值对，请检查格式",
    });
  }

  fs.writeFileSync(COOKIE_FILE, cookie.trim(), "utf-8");
  const count = await injectCookieIntoBrowser(cookie.trim());
  console.log(`✅ [API] 成功完成 Cookie 热更新，已将 ${count} 个字段实时更新至常驻 Chrome 浏览器！`);

  return res.status(200).json({
    success: true,
    message: `Cookie 热更新成功，常驻 Chrome 进程已立刻生效，共载入 ${count} 个字段`,
    cookie_count: count,
  });
});

/**
 * 3. 健康检查与多标签池状态查询：GET /api/status
 */
app.get("/api/status", (req, res) => {
  res.status(200).json({
    success: true,
    service: "AliExpress Scraper HTTP API (Plan A - Tab Pool)",
    status: "healthy",
    active_tabs: activeTabs,
    max_concurrent_tabs: MAX_CONCURRENT_TABS,
    profile_status: {
      cookie_file_exists: fs.existsSync(COOKIE_FILE),
      user_data_profile_exists: fs.existsSync(USER_DATA_DIR),
    },
  });
});

// 优雅关闭：当服务停止时安全关闭常驻 Chrome 进程
process.on("SIGINT", async () => {
  console.log("\n🛑 接收到退出信号，正在安全关闭常驻 Chrome 实例...");
  await closePersistentBrowser();
  process.exit(0);
});

app.listen(PORT, async () => {
  console.log("==========================================================");
  console.log(`🌟 速卖通抓取 HTTP 微服务启动成功！(方案 A：常驻单浏览器 + 多标签页并发池)`);
  console.log(`📡 服务监听端口: http://localhost:${PORT}`);
  console.log("==========================================================");
  // 异步提前预热唤醒常驻浏览器
  getPersistentBrowser().catch((err) =>
    console.error("后台预热启动浏览器出现警示:", err.message)
  );
});
