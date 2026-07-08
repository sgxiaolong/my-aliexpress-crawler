import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as cheerio from "cheerio";
import fs from "fs";

import { get as GetReviews } from "../libs/aliexpress-product-scraper/src/reviews.js";
import { parseJsonp, extractDataFromApiResponse } from "../libs/aliexpress-product-scraper/src/parsers.js";
import { buildProductJson } from "../libs/aliexpress-product-scraper/src/transform.js";
import { normalizeCookies } from "./cookieUtils.js";

puppeteer.use(StealthPlugin());

let persistentBrowser = null;
const USER_DATA_DIR = "./user_data_profile";
const COOKIE_FILE = "./cookie.txt";

/**
 * 获取常驻浏览器单例实例（方案 A：单实例常驻 + 多标签页并发池）
 */
export const getPersistentBrowser = async () => {
  if (persistentBrowser && persistentBrowser.isConnected()) {
    return persistentBrowser;
  }

  console.log("🚀 [BrowserPool] 正在初始化常驻 Puppeteer 浏览器实例...");
  persistentBrowser = await puppeteer.launch({
    headless: true,
    userDataDir: USER_DATA_DIR,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  // 如果启动时本地存在 cookie.txt，立即主动写入该浏览器进程
  if (fs.existsSync(COOKIE_FILE)) {
    try {
      const cookieStr = fs.readFileSync(COOKIE_FILE, "utf-8").trim();
      await injectCookieIntoBrowser(cookieStr);
    } catch (err) {
      console.warn("⚠️ [BrowserPool] 初始载入 cookie.txt 异常:", err.message);
    }
  }

  return persistentBrowser;
};

/**
 * 向已常驻运行的浏览器热注入新 Cookie 凭证（无需关浏览器）
 */
export const injectCookieIntoBrowser = async (cookieStr) => {
  if (!cookieStr) return 0;
  const browser = await getPersistentBrowser();
  const page = await browser.newPage();
  try {
    const parsedCookies = normalizeCookies(cookieStr);
    if (parsedCookies.length > 0) {
      await page.setCookie(...parsedCookies);
      console.log(`🍪 [BrowserPool] 成功向常驻浏览器会话注入 ${parsedCookies.length} 个 Cookie 字段！`);
    }
    return parsedCookies.length;
  } finally {
    await page.close();
  }
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

    // 监听当前 Tab 下的 API 响应流
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("mtop.aliexpress") && url.includes("pdp")) {
        try {
          const text = await response.text();
          if (text && text.length > 1000) {
            const parsed = parseJsonp(text);
            if (parsed?.data?.result) {
              apiData = parsed;
            }
          }
        } catch {
          // 忽略非 JSONP 响应流
        }
      }
    });

    // 访问商品详情页面
    await page.goto(`https://www.aliexpress.com/item/${id}.html`, {
      waitUntil: "networkidle2",
      timeout: timeout,
    });

    let data = null;
    const maxWaitTime = 15000;
    const startTime = Date.now();

    while (!data && Date.now() - startTime < maxWaitTime) {
      if (apiData) {
        data = extractDataFromApiResponse(apiData);
        if (data) break;
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
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!data) {
      throw new Error(
        `拉取商品 ${id} 失败：页面会话可能已过期转跳登录或遭遇人机滑块拦截 (Timeout/Login Required)`
      );
    }

    // 抓取详情描述数据
    const descriptionUrl = data?.productDescComponent?.descriptionUrl;
    let descriptionDataPromise = null;
    if (descriptionUrl) {
      descriptionDataPromise = page.goto(descriptionUrl).then(async () => {
        const descriptionPageHtml = await page.content();
        const $ = cheerio.load(descriptionPageHtml);
        return $("body").html();
      });
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

    return buildProductJson({ data, descriptionData, reviews });
  } finally {
    // 无论是成功还是失败，抓完立刻关闭当前标签页释放内存，绝不影响主浏览器其它标签页
    if (page && !page.isClosed()) {
      await page.close();
    }
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
