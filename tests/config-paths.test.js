import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('采集登录文件固定在项目目录，显式 Profile 仍按启动目录解析', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const module = new URL('../src/config/index.js', import.meta.url).href;
  const script = `import {config} from ${JSON.stringify(module)}; console.log(JSON.stringify(config))`;
  for (const [cwd, override] of [[root, ''], [os.tmpdir(), ''], [os.tmpdir(), 'custom']]) {
    const config = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd, env: { ...process.env, CRAWLER_CHROME_PROFILE_DIR: override }, encoding: 'utf8'
    }));
    assert.equal(config.userDataDir, override ? path.resolve(cwd, override) : path.join(root, 'user_data_profile_puppeteer'));
    assert.equal(config.cookieFile, path.join(root, 'cookie.txt'));
    assert.equal(config.cspCookieFile, path.join(root, 'cookie_csp.txt'));
  }
});
