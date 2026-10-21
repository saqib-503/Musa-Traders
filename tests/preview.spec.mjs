import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
const base = process.env.PREVIEW_URL || 'http://localhost:3000';
let browser, page;
const errors = [];
const external = [];
before(async () => {
  const executablePath = [process.env.BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!executablePath) throw new Error('Set BROWSER_EXECUTABLE to Chrome or Chromium.');
  browser = await chromium.launch({ executablePath, headless: true });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === new URL(base).origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
});
after(async () => { await browser?.close(); });
test('store preview renders every main route without credentials or backend requests', async () => {
  for (const [path, heading] of [['/', 'Gentle things for the smallest people.'], ['/blog','Blog'], ['/cart','Cart'], ['/compare','Compare'], ['/login','Welcome back'], ['/signup','Create your account'], ['/checkout','Checkout'], ['/admin','Admin'], ['/admin/products','Admin'], ['/admin/orders','Admin']]) {
    const response = await page.goto(base + path);
    assert.equal(response.status(), 200, path);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
    await page.getByText('Demo collection', { exact: false }).waitFor();
    if (path === '/checkout') assert.equal(await page.getByRole('button', { name: /Place order/ }).count(), 0);
    if (path === '/login') assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).count(), 0);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});
test('missing catalog details return 404 and sitemap remains available', async () => {
  for (const path of ['/product/not-created','/category/not-created','/blog/not-created']) {
    assert.equal((await page.goto(base + path)).status(), 404, path);
  }
  const response = await fetch(base + '/sitemap.xml');
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes('<urlset'));
  assert.deepEqual(errors, []);
});

test('extension-injected document attributes do not produce hydration warnings', async () => {
  const tab = await browser.newPage();
  const warnings = [];
  tab.on('console', message => {
    if (/hydrat|server rendered HTML|did not match/i.test(message.text())) warnings.push(message.text());
  });
  tab.on('pageerror', error => warnings.push(error.message));
  // Inject the exact reported attributes before any application script executes.
  await tab.route('**/*', async route => {
    if (route.request().isNavigationRequest()) {
      const response = await route.fetch();
      const html = (await response.text())
        .replace('<html ', '<html crxlauncher-bridged="" crxlauncher="" ')
        .replace('<body', '<body data-new-gr-c-s-check-loaded="14.1333.0" data-gr-ext-installed=""');
      return route.fulfill({ response, body: html });
    }
    return route.continue();
  });
  try {
    await tab.goto(base + '/cart');
    await tab.getByRole('heading', { name: 'Cart', exact: true }).waitFor();
    // This empty state is replaced after the cart's useEffect runs, proving hydration completed.
    await tab.evaluate(() => localStorage.setItem('cart', JSON.stringify([{
      variant_id: '30000000-0000-4000-8000-000000000001', name: 'Hydration check', price: 10, qty: 1,
    }])));
    await tab.reload();
    await tab.getByRole('button', { name: 'Remove', exact: true }).click();
    await tab.getByText('Your cart is empty.', { exact: true }).waitFor();
    assert.equal(await tab.locator('html').getAttribute('crxlauncher'), '');
    assert.equal(await tab.locator('body').getAttribute('data-gr-ext-installed'), '');
    assert.deepEqual(warnings, []);
  } finally { await tab.close(); }
});
