import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { config } from "./src/config/index.js";

const urls = process.argv.slice(2);
if (urls.length === 0) throw new Error("At least one URL is required");

const portFile = path.join(config.userDataDir, "DevToolsActivePort");
const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
const browser = await puppeteer.connect({
  browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
  defaultViewport: null,
});

let lastPage = null;
for (const url of urls) {
  const page = await browser.newPage();
  lastPage = page;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
  } catch (error) {
    console.log(JSON.stringify({ url: page.url(), warning: error.message }));
  }
}
if (lastPage) await lastPage.bringToFront();
browser.disconnect();
