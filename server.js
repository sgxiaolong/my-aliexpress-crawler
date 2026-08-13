import { config } from "./src/config/index.js";
import { createApp } from "./src/app.js";
import { closePersistentBrowser, getPersistentBrowser } from "./utils/tabScraper.js";

const app = createApp();

process.on("SIGINT", async () => {
  console.log("\n接收到退出信号，正在安全关闭常驻 Chrome 实例...");
  await closePersistentBrowser();
  process.exit(0);
});

const server = app.listen(config.port, config.host, async () => {
  console.log("==========================================================");
  console.log("AliExpress crawler service started");
  console.log(`Role: scrape-executor`);
  console.log(`URL: http://${config.host}:${config.port}`);
  console.log("==========================================================");

  getPersistentBrowser().catch((err) =>
    console.error("后台预热启动浏览器出现警示:", err.message)
  );
});

server.once("error", (error) => {
  console.error(`AliExpress crawler failed to listen on ${config.host}:${config.port}:`, error.message);
  process.exit(1);
});
