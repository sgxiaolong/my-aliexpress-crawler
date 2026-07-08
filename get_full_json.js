import scrape from "aliexpress-product-scraper";
import fs from "fs";

const productId = process.argv[2] || "1005007856985898";
const outPath = `./full_output_${productId}.json`;

console.log(`🚀 正在调用标准库接口抓取完整商品数据 (ID: ${productId})...`);

try {
  // 核心技巧：使用 userDataDir 读取 interactive_scraper 写入或过验证的凭证目录
  const productData = await scrape(productId, {
    reviewsCount: 10, // 抓取 10 条买家带图评价
    puppeteerOptions: {
      userDataDir: "./user_data_profile",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    },
  });

  // 保存完整的 JSON 结果到文件
  fs.writeFileSync(outPath, JSON.stringify(productData, null, 2), "utf-8");
  console.log(`\n🎉 🎉 🎉 成功获取并生成官方格式的完整富文本 JSON！已保存至: ${outPath}`);

  // 打印主要结构概览信息
  console.log("\n================ [数据概要预览] ================");
  console.log(`📌 商品标题: ${productData.title}`);
  console.log(`📌 商品 ID:  ${productData.id}`);
  console.log(`📌 核心类目: ${productData.categoryName}`);
  console.log(`📌 主图链接: ${productData.mainImage}`);
  console.log(`📌 SKU 数量: ${productData.skus?.length || 0} 种规格`);
  console.log(`📌 评价条数: ${productData.reviews?.length || 0} 条带图/买家评价`);
  console.log(`📌 描述详情: 提取到 HTML 内容长度共 ${productData.description?.length || 0} 字符`);
  console.log("================================================");
} catch (error) {
  console.error("❌ 抓取过程中出现异常:", error.message);
  process.exit(1);
}
