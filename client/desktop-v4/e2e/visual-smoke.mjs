#!/usr/bin/env node
// Isolated Chromium rendering verification: no Local Wall proxy, no Agent or Owner calls.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  // The CI runner may supply Playwright via a separate shared tool installation.
  const modulePath = process.env.LR_PLAYWRIGHT_MODULE;
  if (!modulePath) throw Error('Install playwright or set LR_PLAYWRIGHT_MODULE to an authorized local module path');
  ({ chromium } = require(modulePath));
}

const outputDir = process.env.LR_V4_VISUAL_OUT || path.join(root, 'visual-evidence');
const variants = [
  { theme: 'light', width: 1280, height: 800, columns: 2 },
  { theme: 'dark', width: 1280, height: 800, columns: 2 },
  { theme: 'light', width: 1024, height: 1024, columns: 1 },
  { theme: 'dark', width: 1024, height: 1024, columns: 1 },
  { theme: 'light', width: 1100, height: 900, columns: 1 },
  { theme: 'dark', width: 1152, height: 900, columns: 1 },
  { theme: 'light', width: 768, height: 900, columns: 1 },
  { theme: 'dark', width: 390, height: 844, columns: 1 }
];

async function waitReady(url, timeoutMs = 18000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('preview_server_unreachable');
}

function rectPlain(r) {
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
}

async function inspect(page, variant) {
  return await page.evaluate(({ expectedColumns }) => {
    const by = s => document.querySelector(s);
    const rect = el => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    const nav = Array.from(document.querySelectorAll('nav[aria-label="Main navigation"] a'));
    const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent?.trim() === 'Review owner requests');
    const grid = by('.approval-grid');
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const approval = rect(by('.approval-card'));
    const policy = rect(by('.policy-card'));
    const root = document.documentElement;
    const overflowing = Array.from(document.querySelectorAll('.lr-card, .nav-item, .side-footer, .page-header'))
      .filter(el => el.scrollWidth > el.clientWidth + 3)
      .slice(0, 10).map(el => ({ tag: el.tagName, className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    return {
      route: location.hash,
      navCount: nav.length,
      navLabels: nav.map(el => el.textContent?.trim()),
      settingsVisibleInDom: nav.some(el => el.textContent?.trim() === 'Settings'),
      ownerActionDisabled: Boolean(button?.disabled),
      theme: root.dataset.theme,
      mainHorizontalScroll: root.scrollWidth > innerWidth + 3,
      cardOverflow: overflowing,
      gridColumns: gridStyle?.gridTemplateColumns,
      columnCountObserved: approval && policy ? (Math.abs(approval.y - policy.y) < 8 ? 2 : 1) : 0,
      expectedColumns,
      approval, policy,
      footer: rect(by('.side-footer')),
      settings: rect(nav.at(-1)),
      primaryText: by('.approval-card h3')?.textContent?.trim(),
      noVerifiedGrants: Boolean(Array.from(document.querySelectorAll('h3')).find(el => el.textContent?.trim() === 'No verified grants')),
      statusSource: by('.verification-line')?.textContent?.trim()
    };
  }, { expectedColumns: variant.columns });
}

await mkdir(outputDir, { recursive: true });
const preview = spawn(process.execPath, ['./node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production' }
});
let previewOutput = '';
preview.stdout.on('data', d => { previewOutput += String(d).slice(0, 500); });
preview.stderr.on('data', d => { previewOutput += String(d).slice(0, 500); });
let browser;
const results = [];
try {
  await waitReady('http://127.0.0.1:4174/');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const variant of variants) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 1, colorScheme: variant.theme });
    const page = await context.newPage();
    // Strictly isolate browser visual QA from any real Wall/Operator/Agent.
    await page.route('**/api/**', route => route.fulfill({
      status: 401, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'visual_qa_unauthenticated' })
    }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4174/#/ai-access', { waitUntil: 'networkidle' });
    await page.evaluate(theme => {
      localStorage.setItem('lr-v4-theme', theme);
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    }, variant.theme);
    await page.waitForTimeout(100);
    const detail = await inspect(page, variant);
    const key = `ai-access-${variant.theme}-${variant.width}x${variant.height}`;
    const png = path.join(outputDir, key + '.png');
    await page.screenshot({ path: png, fullPage: true, animations: 'disabled' });
    const passed =
      errors.length === 0 &&
      detail.navCount === 9 &&
      detail.settingsVisibleInDom &&
      detail.ownerActionDisabled &&
      detail.noVerifiedGrants &&
      detail.theme === variant.theme &&
      !detail.mainHorizontalScroll &&
      detail.cardOverflow.length === 0 &&
      detail.columnCountObserved === variant.columns;
    results.push({ key, passed, errors, ...detail, screenshot: png });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${key}: columns=${detail.columnCountObserved} nav=${detail.navCount} overflow=${detail.cardOverflow.length} horizontalScroll=${detail.mainHorizontalScroll}`);
    await context.close();
  }
  await writeFile(path.join(outputDir, 'evidence.json'), JSON.stringify({ date: new Date().toISOString(), source: 'local isolated Chromium headless QA', results }, null, 2) + '\n');
  if (results.some(r => !r.passed)) process.exitCode = 1;
} finally {
  await browser?.close();
  preview.kill('SIGTERM');
}
