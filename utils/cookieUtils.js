/**
 * Cookie 工具函数库
 * 提供从字符串、键值对对象及数组到标准的 Puppeteer Cookie 结构之间的相互转换
 */

/**
 * 将单个键值字符串（如 "name=value"）解析为标准 Cookie 对象
 * @param {string} pairStr
 * @returns {object|null}
 */
const parsePair = (pairStr) => {
  const parts = pairStr.split("=");
  if (parts.length < 2) {
    return null;
  }
  const name = parts[0].trim();
  const value = parts.slice(1).join("=").trim();
  if (!name) {
    return null;
  }
  return {
    name,
    value,
    domain: ".aliexpress.com",
    path: "/",
    httpOnly: false,
    secure: true,
  };
};

/**
 * 将输入 Cookie（支持 Cookie Header 字符串、字典对象或 Cookie 数组）规范化为 Puppeteer setCookie 数组形式
 * @param {string|object|Array} inputCookies
 * @returns {Array<object>}
 */
export const normalizeCookies = (inputCookies) => {
  if (!inputCookies) {
    return [];
  }

  // 情况 1: 传入的本身就是标准的数组（如 Puppeteer page.cookies() 导出的）
  if (Array.isArray(inputCookies)) {
    return inputCookies.map((item) => {
      if (typeof item === "string") {
        return parsePair(item);
      }
      return {
        domain: ".aliexpress.com",
        path: "/",
        httpOnly: false,
        secure: true,
        ...item,
      };
    }).filter(Boolean);
  }

  // 情况 2: 传入的是 HTTP Cookie 字符串 (分号分隔，例如 "aead_id=xxx; xman_f=yyy")
  if (typeof inputCookies === "string") {
    return inputCookies
      .split(";")
      .map((item) => parsePair(item.trim()))
      .filter(Boolean);
  }

  // 情况 3: 传入的是键值对字典对象 { aead_id: "xxx", xman_f: "yyy" }
  if (typeof inputCookies === "object") {
    return Object.entries(inputCookies).map(([name, value]) => ({
      name,
      value: String(value),
      domain: ".aliexpress.com",
      path: "/",
      httpOnly: false,
      secure: true,
    }));
  }

  return [];
};

/**
 * 将规范化的 Cookie 对象数组转回 HTTP Header Cookie 字符串
 * @param {Array<object>} cookiesArray
 * @returns {string}
 */
export const formatCookieHeader = (cookiesArray) => {
  if (!Array.isArray(cookiesArray) || cookiesArray.length === 0) {
    return "";
  }
  return cookiesArray.map((c) => `${c.name}=${c.value}`).join("; ");
};
