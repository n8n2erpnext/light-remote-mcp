import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = await fs.realpath(os.tmpdir());
const scratch = await fs.mkdtemp(path.join(tempRoot, 'lr-memory-pair-'));
const extension = path.join(scratch, 'extension');
const identity = { accountId:'fixture-owner', deviceId:'fixture-device', deviceName:'Fixture PC' };
let statusRequests = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const authenticated = (req.headers.cookie ?? '').includes('lm_pair_fixture=owner');
  if (req.method === 'POST' && url.pathname === '/fixture-login') {
    res.writeHead(303, { location:'/long-memory', 'set-cookie':'lm_pair_fixture=owner; Path=/; SameSite=Strict' });
    return res.end();
  }
  if (url.pathname === '/long-memory') {
    if (!authenticated) {
      res.writeHead(303, { location:'/login?next=%2Flong-memory' });
      return res.end();
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><title>Long Memory fixture</title>');
  }
  if (url.pathname === '/login') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><form action="/fixture-login" method="post"><button>Sign in as test owner</button></form>');
  }
  if (url.pathname === '/api/status' || url.pathname === '/api/gold/modules') {
    if (url.pathname === '/api/status') {
      statusRequests++;
      server.emit('identity-check');
    }
    res.writeHead(authenticated ? 200 : 401, { 'content-type':'application/json' });
    const result = url.pathname === '/api/status' ? { ok:true, local:identity } : { ok:true, modules:{ longMemory:true } };
    return res.end(JSON.stringify(authenticated ? result : { ok:false, error:'wall_auth_required' }));
  }
  res.writeHead(404).end();
});
let browser;
try {
  await fs.cp(path.join(root, 'extensions/light-remote-lm-abv2'), extension, { recursive:true });
  const manifestFile = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  assert.deepEqual(manifest.host_permissions, []);
  // Seed access to the fixture only. Browser-native permission dialogs are outside headless Playwright.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const wall = `${origin}/long-memory`;
  const executablePath = process.env.LR_MEMORY_PAIR_CHROME;
  browser = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    headless:true,
    ...(executablePath ? { executablePath } : { channel:'chromium' }),
    ignoreDefaultArgs:['--disable-extensions'],
    args:['--enable-unsafe-extension-debugging', '--disable-background-networking']
  });
  const cdp = await browser.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path:extension });
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#wallUrl').fill(wall);
  const [setup] = await Promise.all([browser.waitForEvent('page'), popup.getByRole('button', { name:'Pair this Wall' }).click()]);
  await setup.waitForURL(`chrome-extension://${id}/pair.html?*`);
  await popup.close();
  await setup.getByRole('button', { name:'Allow and pair' }).click();
  await setup.getByText(/pairing resumes when it returns/i).waitFor({ timeout:12000 });
  assert.equal(await setup.evaluate(async()=>Boolean((await chrome.storage.local.get('profile')).profile)), false);
  assert.equal(statusRequests, 0);
  const login = browser.pages().find(page=>page.url().startsWith(`${origin}/login?`));
  assert.ok(login, 'pairing opened one owner login tab');
  await setup.getByRole('button', { name:'Open Wall' }).click();
  await login.getByRole('button', { name:'Sign in as test owner' }).click();
  await setup.getByText(/paired with fixture pc/i).waitFor({ timeout:12000 });
  const profile = await setup.evaluate(async()=> (await chrome.storage.local.get('profile')).profile);
  assert.deepEqual(profile, { url:wall, accountId:identity.accountId, deviceId:identity.deviceId, name:identity.deviceName });
  const before = browser.pages().length;
  const checks = statusRequests;
  const nextCheck = once(server, 'identity-check', { signal:AbortSignal.timeout(12000) });
  await setup.getByRole('button', { name:'Allow and pair' }).click();
  await nextCheck;
  await setup.getByText(/paired with fixture pc/i).waitFor({ timeout:12000 });
  assert.equal(browser.pages().length, before, 'an existing matching Wall should be reused');
  assert.ok(statusRequests > checks);
  const reopened = await browser.newPage();
  await reopened.goto(`chrome-extension://${id}/popup.html`);
  await reopened.locator('#status').filter({ hasText:'Paired with Fixture PC' }).waitFor({ timeout:12000 });
  console.log('MEMORY_EXTENSION_INSTALLED_PAIR_PASS popup_closed login_resume existing_wall_reused persisted_profile');
} finally {
  await browser?.close();
  server.closeAllConnections();
  if (server.listening) await new Promise(resolve=>server.close(resolve));
  assert.equal(path.dirname(await fs.realpath(scratch)), tempRoot);
  await fs.rm(scratch, { recursive:true, force:true });
}
