import fs from "fs";
import path from "path";

/**
 * 自动检测本机可用的 Google Chrome 浏览器执行路径
 * 优先级顺序：
 * 1. 用户自定义环境变量 CHROME_PATH
 * 2. Windows 系统默认安装路径 (Program Files / LocalAppData)
 * 3. macOS / Linux 系统默认安装路径
 *
 * @returns {string|undefined} 返回检测到的 Chrome 绝对路径；如未找到返回 undefined（自动使用内嵌 Chromium）
 */
export const getLocalChromePath = () => {
  // 1. 优先检查环境变量自定义路径
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  // 2. Windows 常见 Google Chrome 安装位置
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];

  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.join(
        process.env.LOCALAPPDATA,
        "Google\\Chrome\\Application\\chrome.exe"
      )
    );
  }

  // 3. macOS 与 Linux 常见路径
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  candidates.push("/usr/bin/google-chrome");
  candidates.push("/usr/bin/google-chrome-stable");

  for (const candidatePath of candidates) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
};
