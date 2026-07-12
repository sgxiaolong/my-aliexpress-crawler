import fs from "fs";
import { config } from "../config/index.js";
import { getTabPoolStatus } from "../services/tabPool.service.js";

export const statusController = (req, res) => {
  const pool = getTabPoolStatus();
  return res.status(200).json({
    success: true,
    service: "AliExpress Scraper HTTP API",
    role: "scrape-executor",
    status: "healthy",
    active_tabs: pool.activeTabs,
    max_concurrent_tabs: pool.maxConcurrentTabs,
    queued_tabs: pool.queuedTabs,
    profile_status: {
      cookie_file_exists: fs.existsSync(config.cookieFile),
      csp_cookie_file_exists: fs.existsSync(config.cspCookieFile),
      user_data_profile_exists: fs.existsSync(config.userDataDir),
    },
  });
};
