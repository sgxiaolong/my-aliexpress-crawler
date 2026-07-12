import { config } from "./src/config/index.js";
import { createApp } from "./src/app.js";
import { closePersistentBrowser, getPersistentBrowser } from "./utils/tabScraper.js";

const app = createApp();

process.on("SIGINT", async () => {
  console.log("\n接收到退出信号，正在安全关闭常驻 Chrome 实例...");
  await closePersistentBrowser();
  process.exit(0);
});

app.listen(config.port, async () => {
  console.log("==========================================================");
  console.log("AliExpress crawler service started");
  console.log(`Role: scrape-executor`);
  console.log(`URL: http://localhost:${config.port}`);
  console.log("==========================================================");

  getPersistentBrowser().catch((err) =>
    console.error("后台预热启动浏览器出现警示:", err.message)
  );
});
