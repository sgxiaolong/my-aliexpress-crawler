import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { config } from '../src/config/index.js';
import * as tabPool from '../src/services/tabPool.service.js';
import { HttpError } from '../src/utils/httpError.js';

const source = (await fs.readFile(new URL('../src/services/scrape.service.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');

test('one slot owns one page and main-site failure never starts orphan CSP work', async () => {
  let pages = 0, peak = 0, cspCalls = 0, released = 0;
  const pageWork = async value => {
    peak = Math.max(peak, ++pages);
    await new Promise(resolve => setTimeout(resolve, 5));
    pages--;
    return value;
  };
  const context = vm.createContext({
    console: { log() {} },
    HttpError: class extends Error { constructor(status, code, message) { super(message); this.status = status; } },
    acquireTabSlot: async () => {}, releaseTabSlot: () => released++,
    getTabPoolStatus: () => ({ activeTabs: 0, maxConcurrentTabs: 1 }),
    scrapeWithTab: () => pageWork({ title: 'fixture', categoryId: '1' }),
    fetchCspUrlByProductId: async () => ({ cspUrl: 'fixture' }),
    scrapeCspProductAttrs: () => { cspCalls++; return pageWork({ attrs: { size: '1' } }); },
  });
  vm.runInContext(source + '\nglobalThis.run = scrapeProduct;', context);
  await context.run('1');
  assert.equal(peak, 1);
  assert.equal(cspCalls, 1);
  context.scrapeWithTab = async () => { throw new Error('main failed'); };
  await assert.rejects(context.run('2'), /main failed/);
  assert.equal(cspCalls, 1);
  assert.equal(released, 2);
});

test('product and standalone CSP requests share slots and a failed page releases the next request', async t => {
  const previousLimit = config.maxConcurrentTabs;
  config.maxConcurrentTabs = 1;
  t.after(() => { config.maxConcurrentTabs = previousLimit; });
  const productPage = Promise.withResolvers();
  const cspVisits = [];
  const context = vm.createContext({
    ...tabPool, HttpError, console: { log() {} },
    scrapeWithTab: () => productPage.promise,
    fetchCspUrlByProductId: async id => ({ cspUrl: 'csp-' + id }),
    scrapeCspProductAttrs: async url => {
      cspVisits.push(url);
      if (url === 'broken') throw new Error('page failed');
      return { attrs: { size: '1' }, raw: [] };
    },
  });
  vm.runInContext(source, context);

  const product = context.scrapeProduct('1');
  const failed = assert.rejects(context.scrapeCspAttrs({ cspUrl: 'broken' }),
    { status: 500, errorCode: 'CSP_SCRAPE_FAILED' });
  const standalone = context.scrapeCspAttrs({ productId: '2' });
  // Let the URL lookup finish while the product page still owns the only slot.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cspVisits, []);
  assert.deepEqual(tabPool.getTabPoolStatus(), { activeTabs: 1, queuedTabs: 2, maxConcurrentTabs: 1 });

  productPage.resolve({ title: 'fixture' });
  const [, , result] = await Promise.all([product, failed, standalone]);
  assert.deepEqual(cspVisits, ['csp-1', 'broken', 'csp-2']);
  assert.equal(result.attrs_count, 1);
  assert.deepEqual(tabPool.getTabPoolStatus(), { activeTabs: 0, queuedTabs: 0, maxConcurrentTabs: 1 });
});

test('reconnecting Chrome does not navigate or close existing pages', async () => {
  const file = await fs.readFile(new URL('../utils/tabScraper.js', import.meta.url), 'utf8');
  const code = file.slice(file.indexOf('export const getPersistentBrowser'), file.indexOf('const inspectSessionPage'))
    .replace('export const', 'const');
  const page = url => ({ url: () => url,
    close: () => assert.fail('existing page closed'), goto: () => assert.fail('existing page navigated') });
  const pages = [page('https://www.aliexpress.com/item/123.html'), page('https://csp.aliexpress.com/user-page'), page('https://example.com/work')];
  const browser = { isConnected: () => true, pages: async () => pages, newPage: () => assert.fail('unnecessary new page') };
  const context = vm.createContext({ persistentBrowser: null, browserLaunchingPromise: null,
    connectToExistingBrowser: async () => browser, USER_DATA_DIR: 'fixture',
    COOKIE_FILE: '', CSP_COOKIE_FILE: '', ALIEXPRESS_DOMAIN: '', CSP_DOMAIN: '',
    STARTUP_URLS: ['https://www.aliexpress.com/', 'https://csp.aliexpress.com/'],
    fs: { existsSync: () => false }, URL, console: { log() {} }, startupPages: {},
    keepCrawlerWindowMinimized: () => assert.fail('existing browser minimized') });
  vm.runInContext(code + '\nglobalThis.run = getPersistentBrowser;', context);
  assert.equal(await context.run(), browser);
  assert.equal(context.startupPages.product, pages[0]);
  assert.equal(context.startupPages.csp, pages[1]);
});
