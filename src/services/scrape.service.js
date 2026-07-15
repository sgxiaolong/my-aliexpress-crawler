import fs from "fs";
import {
  scrapeWithTab,
  injectCookieIntoBrowser,
  injectCspCookieIntoBrowser,
  scrapeCspProductAttrs,
} from "../../utils/tabScraper.js";
import { normalizeCookies } from "../../utils/cookieUtils.js";
import { config } from "../config/index.js";
import { HttpError } from "../utils/httpError.js";
import { fetchCspUrlByProductId } from "./cspUrl.service.js";
import { acquireTabSlot, getTabPoolStatus, releaseTabSlot } from "./tabPool.service.js";

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
    msg.includes("401")
  );
};

const mapCspFailureToHttpError = (productId, failReason) => {
  if (
    failReason.includes("CSP_COOKIE_EXPIRED") ||
    failReason.includes("login") ||
    failReason.includes("punish")
  ) {
    return new HttpError(
      401,
      "CSP_COOKIE_EXPIRED",
      "CSP 卖家中心会话已过期或未配置，被转跳至登录/验证页面。请更新 CSP Cookie。",
      { action_required: "RENEW_CSP_COOKIE", details: failReason }
    );
  }

  if (failReason.includes("CSP_ACTIVITY_NOT_FOUND")) {
    return new HttpError(
      404,
      "CSP_ACTIVITY_NOT_FOUND",
      `主站商品存在，但该商品 ID (${productId}) 未查询到报名的 CSP 竞价活动快照，无法获取 CSP 属性。`,
      { details: failReason }
    );
  }

  if (failReason.includes("CSP_SCRAPE_TIMEOUT")) {
    return new HttpError(
      504,
      "CSP_SCRAPE_TIMEOUT",
      "打开了 CSP 竞价页，但在等待时限内接口响应数据未回传（请求超时）。",
      { details: failReason }
    );
  }

  return new HttpError(
    422,
    "CSP_ATTRIBUTES_EMPTY",
    `未能从该 CSP 竞价页面提取到有效的商品属性：${failReason}`,
    { details: failReason }
  );
};

const normalizeCategoryId = (categoryId) => String(categoryId ?? "").trim();

/**
 * CSP 竞价页的末级类目对应当前活动实际要求的商品类目，应优先于商品页数据。
 * 商品页类目仍保留为回退值和排障依据。
 */
export const resolveEffectiveCategory = (productCategoryId, cspCategoryId) => {
  const sourceCategoryId = normalizeCategoryId(productCategoryId);
  const effectiveCspCategoryId = normalizeCategoryId(cspCategoryId);
  return {
    categoryId: effectiveCspCategoryId || sourceCategoryId,
    categorySource: effectiveCspCategoryId ? "csp_bidding" : "product_page",
    sourceCategoryId: sourceCategoryId || null,
  };
};

export async function scrapeProduct(productId, customCookie) {
  const id = String(productId || "").trim();
  if (!id) {
    throw new HttpError(400, "MISSING_PRODUCT_ID", "请提供必须的商品 ID 参数 (id 或 productId)");
  }

  if (customCookie && typeof customCookie === "string") {
    fs.writeFileSync(config.cookieFile, customCookie.trim(), "utf-8");
    await injectCookieIntoBrowser(customCookie.trim());
  }

  const pool = getTabPoolStatus();
  if (pool.activeTabs >= pool.maxConcurrentTabs) {
    console.log(
      `[TabPool] 并发已满 (${pool.activeTabs}/${pool.maxConcurrentTabs})，商品 ${id} 进入等待队列`
    );
  }

  await acquireTabSlot();

  try {
    console.log(`[Scrape] Start product ${id}`);
    const [productRes, cspRes] = await Promise.allSettled([
      scrapeWithTab(id, { reviewsCount: 10 }),
      (async () => {
        const cspMeta = await fetchCspUrlByProductId(id);
        const { attrs, raw, categoryIdList, categoryId, categoryChain } = await scrapeCspProductAttrs(cspMeta.cspUrl);
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
          categoryIdList: categoryIdList || [],
          categoryId: categoryId || "",
          categoryChain: categoryChain || "",
        };
      })(),
    ]);

    if (productRes.status === "rejected") {
      throw productRes.reason;
    }

    if (cspRes.status === "rejected" || !cspRes.value) {
      const failReason =
        cspRes.status === "rejected"
          ? cspRes.reason?.message || "CSP 页面未能抓取属性"
          : "CSP 竞价接口数据异常";
      throw mapCspFailureToHttpError(id, failReason);
    }

    const productData = productRes.value;
    const cspData = cspRes.value;

    if (!productData || !productData.title || String(productData.title).trim() === "") {
      throw new HttpError(
        422,
        "SCRAPE_TITLE_EMPTY",
        `抓取验证失败：主站商品 ${id} 标题为空，可能已转跳登录或商品失效`
      );
    }

    const resolvedCategory = resolveEffectiveCategory(productData.categoryId, cspData.categoryId);
    productData.categoryId = resolvedCategory.categoryId;
    productData.categorySource = resolvedCategory.categorySource;
    productData.sourceCategoryId = resolvedCategory.sourceCategoryId;
    productData.cspInfo = cspData;
    productData.cspProductAttrs = cspData.productAttrs;
    productData.attributes = {
      ...(productData.attributes || {}),
      ...cspData.productAttrs,
    };

    return productData;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isCookieExpiredOrBlockedError(err)) {
      throw new HttpError(
        401,
        "COOKIE_EXPIRED_OR_BLOCKED",
        "速卖通会话已失效、触发人机验证或转跳登录，请更新 Cookie 后重试",
        { action_required: "RENEW_COOKIE", details: err.message }
      );
    }
    throw new HttpError(500, "SCRAPE_FAILED", err.message || "抓取商品数据失败");
  } finally {
    releaseTabSlot();
  }
}

export async function scrapeCspAttrs({ productId, cspUrl, cookie }) {
  if (!productId && !cspUrl) {
    throw new HttpError(
      400,
      "MISSING_PARAMS",
      "请提供 productId（商品ID，自动查最新期 URL）或 cspUrl（直接传竞价报名页链接）"
    );
  }

  if (cookie) {
    await injectCspCookieIntoBrowser(cookie).catch((error) =>
      console.warn("[CSP] 临时 Cookie 注入警告:", error.message)
    );
  }

  let resolvedCspUrl = cspUrl;
  let resolvedMeta = {};
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
    } catch (error) {
      throw new HttpError(
        502,
        "FLASK_CSP_URL_FAILED",
        `无法从竞价数据库查出商品 ${productId} 的 CSP URL：${error.message}`,
        { productId }
      );
    }
  }

  try {
    const { attrs, raw } = await scrapeCspProductAttrs(resolvedCspUrl);
    return {
      productId: productId || null,
      cspUrl: resolvedCspUrl,
      ...resolvedMeta,
      productAttrs: attrs,
      attrs_count: Object.keys(attrs).length,
      raw_key_attributes: raw,
    };
  } catch (error) {
    throw new HttpError(500, "CSP_SCRAPE_FAILED", error.message, {
      productId: productId || null,
      cspUrl: resolvedCspUrl,
    });
  }
}

export async function updateAliCookie(cookie) {
  if (!cookie || typeof cookie !== "string") {
    throw new HttpError(400, "INVALID_COOKIE", "请求参数中必须包含字符串类型的 cookie 字段");
  }

  const normalized = normalizeCookies(cookie);
  if (normalized.length === 0) {
    throw new HttpError(400, "INVALID_COOKIE_FORMAT", "无法解析出有效的速卖通 Cookie 键值对，请检查格式");
  }

  fs.writeFileSync(config.cookieFile, cookie.trim(), "utf-8");
  return await injectCookieIntoBrowser(cookie.trim());
}

export async function updateCspCookie(cookie) {
  if (!cookie || typeof cookie !== "string" || cookie.trim().length < 10) {
    throw new HttpError(400, "INVALID_COOKIE_FORMAT", "无效的 CSP Cookie 字符串，请检查格式");
  }

  fs.writeFileSync(config.cspCookieFile, cookie.trim(), "utf-8");
  return await injectCspCookieIntoBrowser(cookie.trim());
}
