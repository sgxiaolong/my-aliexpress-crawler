export const config = {
  port: process.env.PORT || 3000,
  userDataDir: process.env.CRAWLER_CHROME_PROFILE_DIR || "./user_data_profile_puppeteer",
  cookieFile: "./cookie.txt",
  cspCookieFile: "./cookie_csp.txt",
  flaskBiddingApi: process.env.FLASK_API_BASE || "https://smtkuajingdianshang.cn/api",
  maxConcurrentTabs: Math.max(
    1,
    Number.parseInt(process.env.MAX_CONCURRENT_TABS || "1", 10) || 1
  ),
};
