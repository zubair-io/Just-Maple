/** Processing visibility smoke test with synthetic queue data; no live providers. */
import { chromium, expect } from '../src/web/node_modules/@playwright/test/index.mjs';
import { syntheticBridge } from './today-synthetic-bridge.mjs';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.addInitScript(syntheticBridge);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4320/#/sources');
  await page.getByRole('link', { name: 'Processing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Processing', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Processing queue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'View processing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Processing', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: Sidebar and Sources Processing links render the live queue page.');
} finally { await browser.close(); }
