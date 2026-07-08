import express from "express";
import fs from "fs";
import {
  scrapeWithTab,
  injectCookieIntoBrowser,
  injectCspCookieIntoBrowser,
  getPersistentBrowser,
  closePersistentBrowser,
  scrapeCspProductAttrs,
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
  console.log(`\n=================== 📡 [客户端 ${req.method} ${req.url}] ===================`);
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
    // 并行调用：1. 抓取速卖通主站详情页  2. 自动查 Flask 接口取 CSP URL 并抓取 CSP 卖家中心商品属性
    const [productRes, cspRes] = await Promise.allSettled([
      scrapeWithTab(id, { reviewsCount: 10 }),
      (async () => {
        console.log(`🔗 [API-CSP同步] 正在查询商品 ID: ${id} 对应的 Flask CSP 竞价活动...`);
        const cspMeta = await fetchCspUrlByProductId(String(id).trim());
        console.log(`🏪 [API-CSP同步] 成功查到期数: ${cspMeta.periodName}，正在抓取卖家中心属性...`);
        const { attrs, raw } = await scrapeCspProductAttrs(cspMeta.cspUrl);
        return {
          success: true,
          cspUrl: cspMeta.cspUrl,
          periodName: cspMeta.periodName,
          activityId: cspMeta.activityId,
          taskId: cspMeta.taskId,
          channelId: cspMeta.channelId,
          productAttrs: attrs,
          attrsCount: Object.keys(attrs).length,
          rawKeyAttributes: raw,
        };
      })(),
    ]);

    if (productRes.status === "rejected") {
      throw productRes.reason; // 主站详情页抓取失败则抛出主要异常
    }

    // 严格校验：必须能够同步采集到 CSP 卖家中心商品属性
    if (
      cspRes.status === "rejected" ||
      !cspRes.value ||
      !cspRes.value.attrsCount ||
      cspRes.value.attrsCount === 0
    ) {
      const failReason =
        cspRes.status === "rejected"
          ? cspRes.reason?.message || "CSP 页面未能抓取属性"
          : "CSP 竞价接口未返回任何具体的商品属性（属性数为 0）";

      activeTabs--;
      console.error(
        `❌ [API-TabPool] 商品 ID: ${id} 抓取中断：未能成功获取 CSP 竞价属性！原因 -> ${failReason}`
      );

      // 1. 如果属于 CSP Cookie 失效/转跳登录/人机验证 -> 返回 401
      if (
        failReason.includes("CSP_COOKIE_EXPIRED") ||
        failReason.includes("login") ||
        failReason.includes("punish")
      ) {
        return res.status(401).json({
          success: false,
          error_code: "CSP_COOKIE_EXPIRED",
          message: `CSP 卖家中心会话已过期或未配置，被转跳至登录/验证页面。请在控制面板贴入最新的 CSP Cookie。`,
          action_required: "RENEW_CSP_COOKIE",
          details: failReason,
        });
      }

      // 2. 如果属于数据库未查到该商品报名的 CSP 快照 -> 返回 404
      if (failReason.includes("CSP_ACTIVITY_NOT_FOUND")) {
        return res.status(404).json({
          success: false,
          error_code: "CSP_ACTIVITY_NOT_FOUND",
          message: `主站商品存在，但该商品 ID (${id}) 未查询到报名的 CSP 竞价活动快照，无法获取 CSP 属性。`,
          details: failReason,
        });
      }

      // 3. 如果属于抓包等待超时 -> 返回 504
      if (failReason.includes("CSP_SCRAPE_TIMEOUT")) {
        return res.status(504).json({
          success: false,
          error_code: "CSP_SCRAPE_TIMEOUT",
          message: `打开了 CSP 竞价页，但在等待时限内接口响应数据未回传（请求超时）。`,
          details: failReason,
        });
      }

      // 4. 其他情况（如品类属性为 0 或解析失败） -> 返回 422
      return res.status(422).json({
        success: false,
        error_code: "CSP_ATTRIBUTES_EMPTY",
        message: `未能从该 CSP 竞价页面提取到有效的商品属性：${failReason}`,
        details: failReason,
      });
    }

    const productData = productRes.value;
    const cspData = cspRes.value;

    console.log(
      `🎉 [API-TabPool] 商品 ${id} 双路采集全量成功！(主站详情 + ${cspData.attrsCount} 项 CSP 属性)`
    );
    productData.cspInfo = cspData;
    productData.cspProductAttrs = cspData.productAttrs;
    productData.attributes = {
      ...(productData.attributes || {}),
      ...cspData.productAttrs,
    };

    activeTabs--;
    console.log(`✅ [API-TabPool] 商品 ID: ${id} 双路采集完毕，标签页已关闭！`);

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
 * Flask 竞价服务地址（内部调用，获取最新一期 CSP 竞价报名页 URL）
 */
const FLASK_BIDDING_API = process.env.FLASK_API_BASE || "https://smtkuajingdianshang.cn/api";

/**
 * 根据商品 ID 从 Flask 服务查询最新一期的 CSP 竞价报名页 URL
 * @param {string} productId - 速卖通商品 ID（super_link_id）
 * @returns {Promise<{ cspUrl: string, periodName: string, activityId: number }>}
 */
async function fetchCspUrlByProductId(productId) {
  const apiUrl = `${FLASK_BIDDING_API}/bidding/csp-url?super_link_id=${productId}`;
  console.log(`🔗 [CSP-URL] 正在从 Flask 查询最新竞价 URL: ${apiUrl}`);

  const resp = await fetch(apiUrl, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000), // 15 秒超时
  });

  if (!resp.ok) {
    throw new Error(`Flask 竞价 URL 接口返回 HTTP ${resp.status}`);
  }

  const json = await resp.json();

  // Flask 统一响应结构: { code: 200, data: { csp_url, period_name, activity_id, ... } }
  const data = json?.data || json;
  if (!data?.csp_url) {
    throw new Error(`CSP_ACTIVITY_NOT_FOUND: ${json?.msg || json?.message || "商品 " + productId + " 未找到对应竞价活动快照"}`);
  }

  console.log(`✅ [CSP-URL] 查询成功 → 期数: ${data.period_name} | activity_id: ${data.activity_id}`);
  console.log(`   CSP URL: ${data.csp_url}`);

  return {
    cspUrl: data.csp_url,
    periodName: data.period_name,
    activityId: data.activity_id,
    taskId: data.task_id,
    channelId: data.channel_id,
  };
};

/**
 * 3. CSP 跨境卖家中心竞价报名页「商品属性」抓取：POST /api/scrape/csp-attrs
 *    支持两种调用方式：
 *      方式 A（推荐）：{ "productId": "1005010707036106" }
 *                       → 自动调 Flask 查最新一期 CSP URL → 抓取商品属性
 *      方式 B（兼容）：{ "cspUrl": "https://csp.aliexpress.com/..." }
 *                       → 直接用传入的 URL 抓取
 */
app.post("/api/scrape/csp-attrs", async (req, res) => {
  const { productId, cspUrl: rawCspUrl, cookie } = req.body || {};

  // 参数校验：productId 和 cspUrl 至少提供一个
  if (!productId && !rawCspUrl) {
    return res.status(400).json({
      success: false,
      error_code: "MISSING_PARAMS",
      message: "请提供 productId（商品ID，自动查最新期 URL）或 cspUrl（直接传竞价报名页链接）",
    });
  }

  // 若请求携带了临时 CSP Cookie，先热注入浏览器再抓取
  if (cookie) {
    await injectCspCookieIntoBrowser(cookie).catch((e) =>
      console.warn("[CSP接口] 临时 Cookie 注入警告:", e.message)
    );
  }

  let resolvedCspUrl = rawCspUrl;
  let resolvedMeta = {};

  // 方式 A：通过 productId 自动从 Flask 查出最新一期的 CSP URL
  if (productId) {
    try {
      const result = await fetchCspUrlByProductId(String(productId).trim());
      resolvedCspUrl = result.cspUrl;
      resolvedMeta = {
        period_name: result.periodName,
        activity_id: result.activityId,
        task_id: result.taskId,
        channel_id: result.channelId,
      };
    } catch (err) {
      console.error(`❌ [CSP接口] Flask 查询 CSP URL 失败:`, err.message);
      return res.status(502).json({
        success: false,
        error_code: "FLASK_CSP_URL_FAILED",
        message: `无法从竞价数据库查出商品 ${productId} 的 CSP URL：${err.message}`,
        productId,
      });
    }
  }

  // 执行 CSP 页面商品属性抓取
  try {
    const { attrs, raw } = await scrapeCspProductAttrs(resolvedCspUrl);
    return res.status(200).json({
      success: true,
      productId: productId || null,
      cspUrl: resolvedCspUrl,
      ...resolvedMeta,           // 包含 period_name / activity_id / task_id / channel_id
      productAttrs: attrs,
      attrs_count: Object.keys(attrs).length,
      raw_key_attributes: raw,
    });
  } catch (err) {
    console.error(`❌ [CSP接口] 抓取失败:`, err.message);
    return res.status(500).json({
      success: false,
      error_code: "CSP_SCRAPE_FAILED",
      message: err.message,
      productId: productId || null,
      cspUrl: resolvedCspUrl,
    });
  }
});

/**
 * 2b. CSP 跨境卖家中心 Cookie 热更新：POST /api/cookie/csp/update
 *     请求体：{ "cookie": "csp_session=xxx; ..." }
 */
app.post("/api/cookie/csp/update", async (req, res) => {
  const { cookie } = req.body || {};

  if (!cookie || typeof cookie !== "string" || cookie.trim().length < 10) {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_COOKIE_FORMAT",
      message: "无效的 CSP Cookie 字符串，请检查格式",
    });
  }

  fs.writeFileSync("./cookie_csp.txt", cookie.trim(), "utf-8");
  const count = await injectCspCookieIntoBrowser(cookie.trim());
  console.log(`✅ [API] CSP Cookie 热更新成功，共载入 ${count} 个字段`);

  return res.status(200).json({
    success: true,
    message: `CSP 卖家中心 Cookie 热更新成功，共载入 ${count} 个字段`,
    cookie_count: count,
  });
});

/**
 * 4. 健康检查与多标签池状态查询：GET /api/status
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
