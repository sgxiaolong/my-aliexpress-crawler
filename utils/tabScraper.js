import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

import { get as GetReviews } from "../libs/aliexpress-product-scraper/src/reviews.js";
import { parseJsonp, extractDataFromApiResponse } from "../libs/aliexpress-product-scraper/src/parsers.js";
import { buildProductJson } from "../libs/aliexpress-product-scraper/src/transform.js";
import { normalizeCookies, ALIEXPRESS_DOMAIN, CSP_DOMAIN } from "./cookieUtils.js";

puppeteer.use(StealthPlugin());

let persistentBrowser = null;
let browserLaunchingPromise = null;
let startupPages = { product: null, csp: null };
// 延续既有的独立采集 Profile，切换到系统 Chrome 时无需重新登录。
const USER_DATA_DIR = path.resolve(process.env.CRAWLER_CHROME_PROFILE_DIR || "./user_data_profile_puppeteer");
const CRAWLER_CDP_PORT = Number(process.env.CRAWLER_CDP_PORT || 9223);
const SYSTEM_CHROME_EXECUTABLES = [
  process.env.CRAWLER_CHROME_EXECUTABLE,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe"),
].filter(Boolean);
/** 速卖通商品详情页 Cookie 存储文件 */
const COOKIE_FILE = "./cookie.txt";
/** 跨境卖家中心 CSP Cookie 存储文件 */
const CSP_COOKIE_FILE = "./cookie_csp.txt";
const STARTUP_URLS = [
  "https://www.aliexpress.com/item/1005012147729552.html",
  "https://csp.aliexpress.com/m_apps/aechoice-product-bidding/biddingRegistration?biddingTaskId=84842914&biddingActivityId=101001&superLinkItemId=1005008248138189&activeKey=PRODUCT_BID&channelId=2427919",
];

const resolveSystemChromeExecutable = () =>
  SYSTEM_CHROME_EXECUTABLES.find((candidate) => fs.existsSync(candidate)) || null;

/**
 * 从速卖通原始页面/API 数据中提取可选的商品说明书。
 * 只接受 PDF，其他媒体类型不传给店小秘上架流程。
 */
export const extractInstructionManual = (source) => {
  const info = source?.data?.result?.DESC?.instructionInfo ||
    source?.DESC?.instructionInfo ||
    source?.productDescComponent?.instructionInfo ||
    null;
  if (!info?.mediaUrl || String(info.mediaType || "").toUpperCase() !== "PDF") return null;
  return {
    url: String(info.mediaUrl),
    mediaType: "PDF",
    title: info.title ? String(info.title) : null,
  };
};

/**
 * 尝试通过 DevToolsActivePort 连接本地已经挂载该 userDataDir 运行着的 Chrome 实例
 */
const connectToExistingBrowser = async (userDataDir) => {
  try {
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, "utf-8").trim().split(/\r?\n/);
      const port = lines[0]?.trim();
      const wsPath = lines[1]?.trim();
      if (port && wsPath && Number(port) === CRAWLER_CDP_PORT) {
        const wsEndpoint = `ws://127.0.0.1:${port}${wsPath}`;
        const browser = await puppeteer.connect({
          browserWSEndpoint: wsEndpoint,
          defaultViewport: null,
        });
        return browser;
      }
    }
  } catch (err) {
    // 连接现存实例失败
  }
  return null;
};

/**
 * 清理异常崩溃导致的 Profile 目录残留锁文件
 */
const cleanStaleLockFiles = (userDataDir) => {
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
  for (const file of lockFiles) {
    const fullPath = path.join(userDataDir, file);
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
      } catch (e) {}
    }
  }
};

/**
 * 获取常驻浏览器单例实例（方案 A：单实例常驻 + 多标签页并发池 + 自动复用现存实例 + 并发防冲突）
 */
export const getPersistentBrowser = async () => {
  if (persistentBrowser && persistentBrowser.isConnected()) {
    return persistentBrowser;
  }

  // 防止高并发请求同时触发多次 puppeteer.launch
  if (browserLaunchingPromise) {
    return await browserLaunchingPromise;
  }

  browserLaunchingPromise = (async () => {
    try {
      // 1. 优先连接同一独立 Profile 的系统 Chrome（固定 CDP 9223），若有则直接复用。
      console.log("🚀 [BrowserPool] 正在初始化常驻 Puppeteer 浏览器实例...");
      persistentBrowser = await connectToExistingBrowser(USER_DATA_DIR);
      if (persistentBrowser) {
        console.log("✅ [BrowserPool] 已复用原有 Chrome Profile，会话与已打开页面保持不变。");
      } else {
        const executablePath = resolveSystemChromeExecutable();
        if (!executablePath) {
          throw new Error("未找到系统 Chrome，请设置 CRAWLER_CHROME_EXECUTABLE 指向 chrome.exe");
        }
        persistentBrowser = await puppeteer.launch({
          headless: false,
          defaultViewport: null,
          userDataDir: USER_DATA_DIR,
          executablePath,
          // Puppeteer 默认会随机占用调试端口；这里改为固定 9223，便于服务健康检查与人工排障。
          ignoreDefaultArgs: ["--remote-debugging-port=0"],
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--remote-debugging-address=127.0.0.1",
            `--remote-debugging-port=${CRAWLER_CDP_PORT}`,
            // 保持浏览器在任务栏后台，避免服务启动时抢占当前桌面焦点。
            "--start-minimized",
          ],
        });
        console.log(`✅ [BrowserPool] 系统 Chrome 已以 CDP ${CRAWLER_CDP_PORT} 挂载独立 Profile 启动，多标签页并发池已就绪！`);
      }

      // 启动时同时读取两套 Cookie 文件注入浏览器
      const cookieLoadTasks = [
        { file: COOKIE_FILE, label: "速卖通主站", domain: ALIEXPRESS_DOMAIN },
        { file: CSP_COOKIE_FILE, label: "CSP 卖家中心", domain: CSP_DOMAIN },
      ];
      for (const { file, label, domain } of cookieLoadTasks) {
        if (fs.existsSync(file)) {
          try {
            const cookieStr = fs.readFileSync(file, "utf-8").trim();
            await injectCookieByDomain(cookieStr, domain);
            console.log(`🍪 [BrowserPool] ${label} Cookie 载入完成（文件: ${file}）`);
          } catch (err) {
            console.warn(`⚠️ [BrowserPool] ${label} Cookie 载入异常:`, err.message);
          }
        }
      }

      // Open the requested working pages after cookies have been restored.
      const existingPages = await persistentBrowser.pages();
      await Promise.all(
        existingPages.slice(STARTUP_URLS.length).map((page) => page.close())
      );
      const openedStartupPages = await Promise.all(
        STARTUP_URLS.map(async (url, index) => {
          const page = existingPages[index] || await persistentBrowser.newPage();
          try {
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 60000,
            });
            console.log(`[BrowserPool] Startup page opened: ${url}`);
          } catch (err) {
            // Keep the tab open even when a slow page exceeds the navigation timeout.
            console.warn(`[BrowserPool] Startup page navigation warning: ${url}`, err.message);
          }
          return page;
        })
      );
      startupPages = {
        product: openedStartupPages[0] || null,
        csp: openedStartupPages[1] || null,
      };
      // 不主动前置任何页面；需要登录或处理验证码时由用户从任务栏打开。

      return persistentBrowser;
    } finally {
      browserLaunchingPromise = null;
    }
  })();

  return await browserLaunchingPromise;
};

const inspectSessionPage = async (page, kind) => {
  if (!page || page.isClosed()) {
    return { status: "unknown", message: "浏览器页面尚未就绪" };
  }

  const snapshot = await page.evaluate(() => ({
    url: location.href,
    title: document.title || "",
    text: (document.body?.innerText || "").slice(0, 1200),
  })).catch(() => ({ url: page.url(), title: "", text: "" }));
  const evidence = `${snapshot.url}\n${snapshot.title}\n${snapshot.text}`.toLowerCase();
  const isLogin = /login\.aliexpress\.com|passport\.aliexpress\.com|\b(sign in|login)\b|登录|登陆/.test(evidence);
  const isCaptcha = /sec\.aliexpress\.com|slider|验证码|captcha|security check|punish|validate/.test(evidence);

  if (isCaptcha) {
    return { status: "captcha_required", message: "页面需要完成验证码或安全验证", url: snapshot.url };
  }
  if (isLogin) {
    return { status: "login_required", message: "页面已跳转登录，请在已打开窗口登录", url: snapshot.url };
  }
  if (kind === "csp" && !snapshot.url.includes("csp.aliexpress.com")) {
    return { status: "unknown", message: "CSP 页面正在跳转或尚未加载", url: snapshot.url };
  }
  if (kind === "product" && !snapshot.url.includes("aliexpress.com")) {
    return { status: "unknown", message: "商品页面正在跳转或尚未加载", url: snapshot.url };
  }
  return {
    status: kind === "product" ? "ready" : "logged_in",
    message: kind === "product" ? "商品页可采集，未检测到验证码" : "CSP 后台已登录",
    url: snapshot.url,
  };
};

/**
 * 只读取服务启动时已打开的两个页面，不重新导航、不注入 Cookie。
 * 控制台据此展示主站验证码状态与 CSP 登录状态。
 */
export const getAliExpressSessionStatus = async () => {
  try {
    await getPersistentBrowser();
    const [product, csp] = await Promise.all([
      inspectSessionPage(startupPages.product, "product"),
      inspectSessionPage(startupPages.csp, "csp"),
    ]);
    return { product, csp };
  } catch (error) {
    const message = error?.message || String(error);
    return {
      product: { status: "offline", message },
      csp: { status: "offline", message },
    };
  }
};

/**
 * 内部通用 Cookie 注入函数（支持指定域名）
 * @param {string} cookieStr - Cookie 字符串
 * @param {string} domain - 目标域名
 */
const injectCookieByDomain = async (cookieStr, domain) => {
  if (!cookieStr) return 0;
  const browser = await getPersistentBrowser();
  const page = await browser.newPage();
  try {
    const parsedCookies = normalizeCookies(cookieStr, domain);
    if (parsedCookies.length > 0) {
      await page.setCookie(...parsedCookies);
    }
    return parsedCookies.length;
  } finally {
    await page.close();
  }
};

/**
 * 向常驻浏览器热注入「速卖通主站 (aliexpress.com)」Cookie
 * @param {string} cookieStr
 */
export const injectCookieIntoBrowser = async (cookieStr) => {
  const count = await injectCookieByDomain(cookieStr, ALIEXPRESS_DOMAIN);
  if (count > 0) {
    console.log(`🍪 [BrowserPool] 成功热注入速卖通主站 Cookie ${count} 个字段！`);
  }
  return count;
};

/**
 * 向常驻浏览器热注入「CSP 跨境卖家中心 (csp.aliexpress.com)」Cookie
 * @param {string} cookieStr
 */
export const injectCspCookieIntoBrowser = async (cookieStr) => {
  const count = await injectCookieByDomain(cookieStr, CSP_DOMAIN);
  if (count > 0) {
    console.log(`🍪 [BrowserPool] 成功热注入 CSP 卖家中心 Cookie ${count} 个字段！`);
  }
  return count;
};

/**
 * 方案 A 核心方法：基于多标签页 (Tab) 并行抓取商品信息
 * @param {string} id 商品 ID
 * @param {object} options 配置参数
 */
export const scrapeWithTab = async (
  id,
  { reviewsCount = 10, filterReviewsBy = "all", timeout = 60000 } = {}
) => {
  if (!id) {
    throw new Error("请提供有效的速卖通商品 ID");
  }

  const browser = await getPersistentBrowser();
  // 核心：在常驻浏览器中打开一个新的并发标签页 (Tab)
  const page = await browser.newPage();

  try {
    let apiData = null;

    // 监听发送出去的请求
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("mtop.aliexpress") || url.includes("aliexpress.com/item/")) {
        console.log(`🌐 [HTTP请求] ${req.method()} -> ${url}`);
      }
    });

    // 监听接收到的 HTTP 响应流
    page.on("response", async (response) => {
      const url = response.url();
      const status = response.status();
      if (url.includes("mtop.aliexpress") || url.includes("aliexpress.com/item/")) {
        console.log(`📥 [HTTP响应] 状态码: ${status} | URL: ${url.slice(0, 100)}...`);
      }
      if (url.includes("mtop.aliexpress") && url.includes("pdp")) {
        try {
          const text = await response.text();
          console.log(`📦 [API截获] 收到 pdp 详情报文，大小: ${text?.length} 字节`);
          if (text && text.length > 1000) {
            const parsed = parseJsonp(text);
            if (parsed?.data?.result) {
              apiData = parsed;
              console.log(`✨ [API截获] 成功从报文中解析出 JSON API 数据结构！`);
            }
          }
        } catch (err) {
          console.warn(`⚠️ [API截获] 读取详情报文异常:`, err.message);
        }
      }
    });

    // 访问商品详情页面
    const targetUrl = `https://www.aliexpress.com/item/${id}.html`;
    console.log(`🚀 [页面跳转] 准备打开商品详情页面: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeout,
    });

    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`📄 [当前页面] 标题: "${pageTitle}" | 最终有效地址: ${currentUrl}`);

    let data = null;
    let instructionManual = null;
    const maxWaitTime = 15000;
    const startTime = Date.now();

    while (!data && Date.now() - startTime < maxWaitTime) {
      if (apiData) {
        data = extractDataFromApiResponse(apiData);
        if (data) {
          instructionManual = extractInstructionManual(apiData);
          console.log(`🎉 [数据提取] 从拦截 API 成功提取商品核心数据！商品标题: ${data.subject || data.title}`);
          break;
        }
      }

      const runParamsData = await page.evaluate(() => {
        try {
          return window.runParams?.data || null;
        } catch {
          return null;
        }
      });

      if (runParamsData && Object.keys(runParamsData).length > 0) {
        data = runParamsData;
        instructionManual = extractInstructionManual(runParamsData);
        console.log(`🎉 [数据提取] 从 window.runParams 成功提取商品核心数据！`);
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!data) {
      const htmlSnippet = await page.content();
      console.error(`❌ [拉取失败诊断] 当前网页标题: "${pageTitle}" | URL: ${currentUrl}`);
      console.error(`❌ [网页 HTML 片段前 300 字符]: ${htmlSnippet.slice(0, 300).replace(/\n/g, " ")}`);
      throw new Error(
        `拉取商品 ${id} 失败：页面标题[${pageTitle}] 会话可能已过期转跳登录或遭遇人机滑块拦截 (Timeout/Login Required)`
      );
    }

    // 抓取详情描述数据：为避免覆盖当前主详情页的 DOM 状态，采用独立 HTTP 快速拉取策略
    const descriptionUrl = data?.productDescComponent?.descriptionUrl;
    let descriptionDataPromise = Promise.resolve("");
    if (descriptionUrl) {
      descriptionDataPromise = (async () => {
        try {
          // 优先使用轻量级 HTTP 请求拉取描述 HTML，避免对主页面句柄二次跳转
          const resp = await fetch(descriptionUrl, { signal: AbortSignal.timeout(10000) });
          if (!resp.ok) return "";
          const htmlText = await resp.text();
          const $ = cheerio.load(htmlText);
          return $("body").html() || htmlText;
        } catch {
          return "";
        }
      })();
    }

    // 并行抓取评价数据
    const reviewsPromise = GetReviews({
      productId: id,
      limit: reviewsCount,
      total: data.feedbackComponent?.totalValidNum || 0,
      filterReviewsBy,
    });

    const [descriptionData, reviews] = await Promise.all([
      descriptionDataPromise,
      reviewsPromise,
    ]);

    const productResult = {
      ...buildProductJson({ data, descriptionData, reviews }),
      instructionManual,
    };

    // 以商品标题 (title) 是否有效非空作为主站抓取是否成功的最终判断依据
    if (!productResult || !productResult.title || String(productResult.title).trim() === "") {
      throw new Error(`SCRAPE_TITLE_EMPTY: 商品 ${id} 抓取主站失败，未能提取到有效的商品标题`);
    }

    return productResult;
  } finally {
    // 无论是成功还是失败，抓完立刻关闭当前标签页释放内存，绝不影响主浏览器其它标签页
    if (page && !page.isClosed()) {
      await page.close();
    }
  }
};

/**
 * 抓取 CSP 跨境卖家中心竞价报名页面的「商品属性」键值对
 * 策略：拦截页面加载时自动发起的 mtop.ae.price.super.link.bidding.task.query 接口
 *       从响应 JSON 的 keyAttributes 数组中精准提取属性，避免 DOM 噪声污染
 * @param {string} cspUrl - 完整的 CSP 竞价报名页面 URL
 * @param {number} timeout - 超时毫秒数，默认 60000
 * @returns {Promise<{ attrs: Record<string, string>, raw: Array }>}
 */
export const scrapeCspProductAttrs = async (cspUrl, timeout = 60000) => {
  if (!cspUrl) throw new Error("请提供有效的 CSP 竞价报名页面 URL");

  const browser = await getPersistentBrowser();
  const page = await browser.newPage();

  try {
    console.log(`🏪 [CSP抓取] 正在打开竞价页: ${cspUrl}`);

    /** 存放从网络拦截到的原始 keyAttributes 数组 */
    let capturedKeyAttributes = null;
    /** CSP 竞价接口给出的完整类目链及其末级类目 */
    let capturedCategoryIdList = [];
    let capturedCategoryId = "";
    let capturedCategoryChain = "";

    // 拦截来自 seller-acs.aliexpress.com 的竞价任务查询接口响应
    page.on("response", async (response) => {
      const url = response.url();
      // 精准匹配 bidding.task.query 接口（即截图中的 Request URL）
      if (
        url.includes("seller-acs.aliexpress.com") &&
        url.includes("mtop.ae.price.super.link.bidding.task.query")
      ) {
        try {
          // 提前过滤预检请求或非成功响应报文，避免读取空报文触发 JSON 解析报错
          const status = response.status();
          if (status < 200 || status >= 300) return;
          const reqMethod = response.request().method();
          if (reqMethod === "OPTIONS") return;

          const text = await response.text();
          if (!text || text.trim().length < 5) return;

          console.log(`📦 [CSP-API] 截获竞价任务查询接口，响应大小: ${text.length} 字节`);
          const json = JSON.parse(text);

          // 此接口的标准结构是 data.data.biddingTaskInfo；保留递归兜底，
          // 避免接口外层包装调整后丢失类目信息。
          const extractBiddingTaskInfo = (obj, depth = 0) => {
            if (!obj || typeof obj !== "object" || depth > 6) return null;
            if (Array.isArray(obj.categoryIdList)) return obj;
            for (const value of Object.values(obj)) {
              if (value && typeof value === "object") {
                const found = extractBiddingTaskInfo(value, depth + 1);
                if (found) return found;
              }
            }
            return null;
          };
          const biddingTaskInfo = extractBiddingTaskInfo(json);
          const categoryIdList = Array.isArray(biddingTaskInfo?.categoryIdList)
            ? biddingTaskInfo.categoryIdList
                .map((categoryId) => String(categoryId ?? "").trim())
                .filter(Boolean)
            : [];
          if (categoryIdList.length) {
            capturedCategoryIdList = categoryIdList;
            capturedCategoryId = categoryIdList.at(-1);
            capturedCategoryChain = String(biddingTaskInfo?.supperLinkItemCategory || "").trim();
            console.log(
              `🗂️ [CSP-API] 获取竞价类目：${capturedCategoryIdList.join(" > ")}（末级 ${capturedCategoryId}）`
            );
          }

          // 深度查找响应结构中的 keyAttributes / itemAttributes / attributes
          const extractAttrs = (obj, depth = 0) => {
            if (!obj || typeof obj !== "object" || depth > 6) return null;
            if (Array.isArray(obj.keyAttributes)) return obj.keyAttributes;
            if (Array.isArray(obj.itemAttributes)) return obj.itemAttributes;
            if (Array.isArray(obj.attributes)) return obj.attributes;
            for (const k of Object.keys(obj)) {
              if (obj[k] && typeof obj[k] === "object") {
                const found = extractAttrs(obj[k], depth + 1);
                if (found !== null) return found;
              }
            }
            return null;
          };

          const foundAttrs = extractAttrs(json);
          if (foundAttrs !== null) {
            capturedKeyAttributes = foundAttrs;
            console.log(`✨ [CSP-API] 成功提取到商品竞价属性 (keyAttributes)，共 ${capturedKeyAttributes.length} 项`);
          } else {
            console.warn(`⚠️ [CSP-API] 响应 JSON 中未匹配到 keyAttributes 数组，预览:`, JSON.stringify(json).slice(0, 300));
          }
        } catch (err) {
          console.warn(`⚠️ [CSP-API] 解析响应 JSON 失败:`, err.message);
        }
      }
    });

    await page.goto(cspUrl, { waitUntil: "domcontentloaded", timeout });

    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`📄 [CSP页面] 标题: "${pageTitle}" | URL: ${currentUrl}`);

    // 精准鉴别 1：如果转跳到登录页、通行证或安全风控页，必定为 CSP Cookie 缺失或失效！
    if (
      currentUrl.includes("login.aliexpress.com") ||
      currentUrl.includes("passport.aliexpress.com") ||
      currentUrl.includes("punish") ||
      pageTitle.includes("登录") ||
      pageTitle.includes("Login")
    ) {
      throw new Error("CSP_COOKIE_EXPIRED: 当前 CSP 卖家中心已转跳至登录/拦截页面，Cookie 未设置或已失效");
    }

    // 等待 API 响应被截获（最多等 25 秒）
    const waitStart = Date.now();
    while (capturedKeyAttributes === null && Date.now() - waitStart < 25000) {
      await new Promise((r) => setTimeout(r, 500));
    }

    if (capturedKeyAttributes === null) {
      // 截图备查
      const screenshotPath = `./debug_csp_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.warn(`⚠️ [CSP抓取] 超时未截获到 keyAttributes，诊断截图: ${screenshotPath}`);
      throw new Error("CSP_SCRAPE_TIMEOUT: CSP 竞价页加载已达 25 秒，未截取到竞价属性查询接口的数据返回");
    }

    // 将 keyAttributes 数组转换为简洁键值对格式
    // 原始结构: [{ key, name, valueList: [{ value, valueId }] }]
    /** @type {Record<string, string>} */
    const productAttrs = {};
    for (const attr of capturedKeyAttributes) {
      const attrName = attr.name || attr.label || String(attr.key);
      const attrValue = attr.valueList?.[0]?.value ?? attr.value ?? "";
      if (attrName && attrValue) {
        productAttrs[attrName] = String(attrValue);
      }
    }

    console.log(
      `🎉 [CSP抓取] 商品属性提取完成，共 ${Object.keys(productAttrs).length} 个:`,
      productAttrs
    );

    return {
      attrs: productAttrs,
      // 同时保留原始结构，供调用方按需使用
      raw: capturedKeyAttributes,
      // CSP 竞价类目是店小秘上架的优先分类依据；categoryId 为末级类目。
      categoryIdList: capturedCategoryIdList,
      categoryId: capturedCategoryId,
      categoryChain: capturedCategoryChain,
    };
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
};

/**
 * 进程关闭时安全销毁常驻浏览器
 */
export const closePersistentBrowser = async () => {
  if (persistentBrowser) {
    await persistentBrowser.close();
    persistentBrowser = null;
  }
};
