import fs from "fs";
import path from "path";

/**
 * 数据归档目录（基于当前工作空间的相对路径）
 */
const DATA_DIR = "./data";

/**
 * 将抓取完成的数据持久化写入 data 目录
 * @param {string} productId - 速卖通商品 ID
 * @param {object} productData - 完整商品数据对象（包含主站与 CSP 站点信息）
 * @returns {string} 归档写入的目标相对路径
 */
export const saveScrapedProductData = (productId, productData) => {
  if (!productId || !productData) {
    return "";
  }

  // 确保 data 目录存在，若无则递归自动创建
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const filePath = path.join(DATA_DIR, `${productId}.json`);
  const jsonStr = JSON.stringify(productData, null, 2);

  fs.writeFileSync(filePath, jsonStr, "utf-8");
  return filePath;
};
