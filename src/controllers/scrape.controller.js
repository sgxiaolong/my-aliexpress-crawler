import { scrapeCspAttrs, scrapeProduct } from "../services/scrape.service.js";
import { sendError } from "../utils/httpError.js";

export const scrapeProductController = async (req, res) => {
  try {
    const id = req.query.id || req.body?.id || req.body?.productId;
    const customCookie = req.headers["x-ali-cookie"] || req.body?.cookie;
    const data = await scrapeProduct(id, customCookie);
    return res.status(200).json({
      success: true,
      mode: "Browser-Tab-Pool (Plan A)",
      timestamp: new Date().toISOString(),
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

export const scrapeCspAttrsController = async (req, res) => {
  try {
    const result = await scrapeCspAttrs(req.body || {});
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
};
