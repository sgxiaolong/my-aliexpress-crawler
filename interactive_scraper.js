import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import fs from "fs";
import { normalizeCookies } from "./utils/cookieUtils.js";
import { getLocalChromePath } from "./utils/chromeFinder.js";

puppeteer.use(StealthPlugin());

// 你可以在这里更换任意你想抓取的商品 ID
const productId = process.argv[2] || "1005007856985898";

// 优先尝试读取本地 cookie.txt 文件，其次读取环境变量 ALI_COOKIE
let initialCookie = process.env.ALI_COOKIE || "";
if (fs.existsSync("./cookie.txt")) {
  initialCookie = fs.readFileSync("./cookie.txt", "utf-8").trim();
}

const userDataDir = "./user_data_profile"; // 凭证持久化文件夹（外部 Cookie 将自动固化至该文件夹内）

console.log("==================================================");
console.log(`🚀 启动“Cookie 注入自动固化 + 人工辅助过验”模式`);
console.log(`📦 目标商品 ID: ${productId}`);
console.log(`🍪 初始 Cookie: ${initialCookie ? "已加载外部 Cookie，即将固化至 profile" : "未提供外部 Cookie"}`);
console.log(`📁 Profile 存储目录: ${userDataDir}`);
console.log("==================================================\n");

console.log("[1/4] 正在启动桌面浏览器并挂载配置目录...");
const chromePath = getLocalChromePath();
if (chromePath) {
  console.log(`🌟 检测到本机安装的 Google Chrome，将使用: ${chromePath}`);
} else {
  console.log("ℹ️ 未检测到本机 Chrome 或未设置 CHROME_PATH，自动使用自带 Chromium");
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: false, // 必须为 false，让用户能看到并操作浏览器
  userDataDir: userDataDir, // 挂载文件夹，页面后续所有 Cookie 都会自动保存于此
  defaultViewport: null,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--start-maximized",
  ],
});

const page = await browser.newPage();

// 注入已有的 Cookie（由于浏览器带 userDataDir 启动，注入后访问网站会自动永久固化到该目录）
const parsedCookies = normalizeCookies(initialCookie);
if (parsedCookies.length > 0) {
  await page.setCookie(...parsedCookies);
  console.log(`✅ 成功将外部 ${parsedCookies.length} 个 Cookie 写入并固化至 ${userDataDir} 目录！`);
}

// 监听 API 响应
let apiData = null;
page.on("response", async (response) => {
  try {
    const url = response.url();
    if (url.includes("mtop.aliexpress.item.detail.data.get")) {
      console.log("⚡ 捕获到目标商品核心数据响应 URL:", url.slice(0, 80) + "...");
      const text = await response.text();

      if (text && text.includes("(")) {
        const jsonStr = text.substring(
          text.indexOf("(") + 1,
          text.lastIndexOf(")")
        );
        const json = JSON.parse(jsonStr);

        if (json.data && Object.keys(json.data).length > 0) {
          apiData = json.data;
          console.log("🎉 成功从响应流中抓取到商品核心 JSON 结构！");
        }
      }
    }
  } catch (err) {
    // 忽略无关接口解析报错
  }
});

console.log(`[2/4] 打开商品详情页 https://www.aliexpress.com/item/${productId}.html ...`);
const targetUrl = `https://www.aliexpress.com/item/${productId}.html`;
await page.goto(targetUrl, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});

console.log("\n==================================================");
console.log("🛑 请在浏览器窗口中查看是否正常加载了页面！");
console.log("👉 如果出现滑块验证或验证码，请在窗口中手动完成验证码。");
console.log("👉 验证完成后，请在控制台按一下 【 Enter 回车键 】 导出验证结果。");
console.log("==================================================\n");

// 等待用户手动处理完毕后按下回车
await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => {
    resolve();
  });
});

console.log("[3/4] 正在提取当前页面的最新 Cookie...");
const cookies = await page.cookies();
const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

fs.writeFileSync("./cookie.txt", cookieStr, "utf-8");
console.log(`✅ 已保存 ${cookies.length} 个 Cookie 字段至根目录的 cookie.txt 文件。`);

if (apiData) {
  console.log("[4/4] 保存抓取到的完整商品 JSON...");
  fs.writeFileSync(
    `./interactive_output_${productId}.json`,
    JSON.stringify(apiData, null, 2),
    "utf-8"
  );
  console.log(`🎉 数据已存入: interactive_output_${productId}.json`);
} else {
  console.log("⚠️ 提示: 本次会话没有捕获到 API 数据流，但会话状态与 Cookie 已成功保存！");
}

await browser.close();
console.log("👋 流程完成，已关闭浏览器。");
process.exit(0);
