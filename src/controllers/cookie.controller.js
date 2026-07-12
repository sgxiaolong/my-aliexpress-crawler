import { updateAliCookie, updateCspCookie } from "../services/scrape.service.js";
import { sendError } from "../utils/httpError.js";

export const updateAliCookieController = async (req, res) => {
  try {
    const count = await updateAliCookie(req.body?.cookie);
    return res.status(200).json({
      success: true,
      message: `Cookie 热更新成功，常驻 Chrome 进程已立刻生效，共载入 ${count} 个字段`,
      cookie_count: count,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateCspCookieController = async (req, res) => {
  try {
    const count = await updateCspCookie(req.body?.cookie);
    return res.status(200).json({
      success: true,
      message: `CSP 卖家中心 Cookie 热更新成功，共载入 ${count} 个字段`,
      cookie_count: count,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
