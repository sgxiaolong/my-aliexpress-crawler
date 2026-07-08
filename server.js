import express from "express";
import fs from "fs";
import scrape from "aliexpress-product-scraper";
import { normalizeCookies } from "./utils/cookieUtils.js";

const app = express();
const PORT = process.env.PORT || 3000;
const USER_DATA_DIR = "./user_data_profile";
const COOKIE_FILE = "./cookie.txt";

app.use(express.json({ limit: "10mb" }));

// 简单的并发控制器，防止同时发起过多无头浏览器实例导致 CPU/内存占用过高
let activeScrapes = 0;
const MAX_CONCURRENT_SCRAPES = 3;

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
 * 1. 抓取接口：支持 GET /api/scrape?id=1005007856985898 或 POST /api/scrape
 *    请求体/查询参数支持可选的 cookie 覆盖参数
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

  if (activeScrapes >= MAX_CONCURRENT_SCRAPES) {
    return res.status(429).json({
      success: false,
      error_code: "TOO_MANY_REQUESTS",
      message: `当前并发抓取任务已达到上限 (${MAX_CONCURRENT_SCRAPES})，请稍后重试`,
    });
  }

  // 如果请求带来了临时 Cookie，更新或写入到 cookie.txt
  if (customCookie && typeof customCookie === "string") {
    fs.writeFileSync(COOKIE_FILE, customCookie.trim(), "utf-8");
    console.log(`🍪 [API] 接收到请求级临时 Cookie 并更新保存至 ${COOKIE_FILE}`);
  }

  activeScrapes++;
  console.log(`🚀 [API] 开始抓取商品 ID: ${id} (当前正在运行抓取任务数: ${activeScrapes})`);

  try {
    const productData = await scrape(id, {
      reviewsCount: 10,
      puppeteerOptions: {
        userDataDir: USER_DATA_DIR,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      },
    });

    activeScrapes--;
    console.log(`✅ [API] 商品 ID: ${id} 抓取成功！`);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      data: productData,
    });
  } catch (err) {
    activeScrapes--;
    console.error(`❌ [API] 商品 ID: ${id} 抓取异常:`, err.message);

    // 智能检测 Cookie 过期或被风控拦截
    if (isCookieExpiredOrBlockedError(err)) {
      return res.status(401).json({
        success: false,
        error_code: "COOKIE_EXPIRED_OR_BLOCKED",
        message: "速卖通会话已失效、被安全拦截或超时，请更新 Cookie 凭证后重试",
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
 * 2. Cookie 热更新接口：POST /api/cookie/update
 *    支持上层客户端随时推送新的 Cookie 会话凭证
 */
app.post("/api/cookie/update", (req, res) => {
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
  console.log(`✅ [API] Cookie 已通过 HTTP 接口成功热更新！解析出 ${normalized.length} 个字段`);

  return res.status(200).json({
    success: true,
    message: `Cookie 热更新成功，共加载 ${normalized.length} 个 Cookie 字段`,
    cookie_count: normalized.length,
  });
});

/**
 * 3. 健康检查与状态检查：GET /api/status
 */
app.get("/api/status", (req, res) => {
  let hasCookieFile = fs.existsSync(COOKIE_FILE);
  let hasProfileDir = fs.existsSync(USER_DATA_DIR);

  res.status(200).json({
    success: true,
    service: "AliExpress Scraper HTTP API",
    status: "healthy",
    active_scrapes: activeScrapes,
    max_concurrent: MAX_CONCURRENT_SCRAPES,
    profile_status: {
      cookie_file_exists: hasCookieFile,
      user_data_profile_exists: hasProfileDir,
    },
  });
});

app.listen(PORT, () => {
  console.log("==========================================================");
  console.log(`🌟 速卖通抓取 HTTP 微服务启动成功！监听端口: http://localhost:${PORT}`);
  console.log("==========================================================");
  console.log(`📡 抓取商品数据:   GET  http://localhost:${PORT}/api/scrape?id=<商品ID>`);
  console.log(`📡 Cookie 热更新:  POST http://localhost:${PORT}/api/cookie/update`);
  console.log(`📡 健康检查接口:   GET  http://localhost:${PORT}/api/status`);
  console.log("==========================================================");
});
