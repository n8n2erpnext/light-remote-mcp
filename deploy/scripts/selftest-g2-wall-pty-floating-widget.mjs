import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';

const mod=await import('playwright').catch(()=>null);
if(!mod){console.log('G2_PTY_FLOATING_BROWSER=SKIPPED (playwright unavailable)');process.exit(0);}
const browserPath=mod.chromium.executablePath();
if(!fs.existsSync(browserPath)){console.log('G2_PTY_FLOATING_BROWSER=SKIPPED (chromium unavailable)');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-g2-float-'));
const file=path.join(dir,'auth.json');
writeLocalWallAuthConfig(file,{username:'owner',password:'fixture-floating-pty-password',sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(file,{required:true});
const port=29000+(process.pid%18000);
let readCalls=0;
const terminalId='ltm_ABCDEFGHIJKLMNOPQRSTUVWX';
const wall=startLocalWall({host:'127.0.0.1',port,
  brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,auth,
  getLocalStatus:async()=>({deviceId:'g2-local',deviceName:'G2 Widget Fixture',enrolled:true,cloudState:'disconnected'}),
  getRemoteStatus:async()=>({sessions:[]}),getRemoteActivity:async()=>({events:[]}),
  getLocalPolicyStatus:async()=>({deviceName:'G2 Widget Fixture',discoveredCapabilities:['terminal','filesystem'],policyRevision:1,allowedCapabilities:['terminal']}),
  getLocalTerminals:async()=>[{terminalId,sessionId:'s_g2_fixture',shell:'bash',state:'running',outputBytes:22}],
  readLocalTerminal:async()=>{readCalls++;return{terminalId,sessionId:'s_g2_fixture',state:'running',output:{text:'G2_WIDGET_OUTPUT_VISIBLE',nextOffset:22,totalBytes:22,baseOffset:0,truncatedBefore:false}};}
});
let browser;
const base='http://127.0.0.1:'+port;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  browser=await mod.chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(base+'/login');
  await page.locator('input[name=username]').fill('owner');
  await page.locator('input[name=password]').fill('fixture-floating-pty-password');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(base+'/');
  await page.goto(base+'/permissions');
  const icon=page.locator('.wall-back svg.mi');
  assert.equal(await icon.count(),1,'Back Wall uses a local SVG');
  const iconSize=await icon.evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
  assert.ok(iconSize.width>=16&&iconSize.height>=16,'Back Wall SVG sized visibly');
  await page.locator('.wall-back').click();
  await page.waitForURL(base+'/');
  assert.equal(await page.locator('#ptyOpen svg.mi').count(),1,'PTY launcher has Material terminal icon');
  assert.equal(await page.locator('#ptyOverlay').isVisible(),false,'widget initially closed');
  await page.locator('#ptyOpen').click();
  assert.equal(await page.locator('#ptyPanel').isVisible(),true,'widget opens');
  assert.equal(await page.locator('#ptyOverlay').getAttribute('aria-modal'),'false','nonmodal wall widget');
  const panel=page.locator('#ptyPanel');
  let rect=await panel.boundingBox();
  assert.ok(rect&&rect.width>300&&rect.height>300,'floating desktop panel has useful size');
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).resize),'both','resizable native panel');
  const oldX=rect.x,oldY=rect.y;
  await page.mouse.move(rect.x+135,rect.y+18);
  await page.mouse.down();
  await page.mouse.move(rect.x-95,rect.y-80,{steps:8});
  await page.mouse.up();
  rect=await panel.boundingBox();
  assert.ok(rect.x<oldX-100 && rect.y<oldY-50,'header pointer drag moves panel');
  // Clicking elsewhere on the Wall remains possible with the floating panel open.
  await page.locator('#filter').fill('non-destructive-fixture');
  assert.equal(await page.locator('#filter').inputValue(),'non-destructive-fixture');
  await page.locator('#ptyRefresh').click();
  await page.locator('#ptyList button').first().click();
  await page.locator('#ptyOutput').getByText('G2_WIDGET_OUTPUT_VISIBLE').first().waitFor({timeout:5000});
  assert.ok(readCalls>=1,'PTY fetched only after opening and selecting the terminal');
  await page.locator('#ptyMinimize').click();
  assert.equal(await page.locator('#ptyOverlay').evaluate(el=>el.classList.contains('minimized')),true);
  assert.equal(await page.locator('#ptyOutput').isVisible(),false);
  const beforeMin=readCalls;await sleep(1750);assert.equal(readCalls,beforeMin,'PTY polling stops when minimized');
  await page.locator('#ptyMinimize').click();
  assert.equal(await page.locator('#ptyOverlay').evaluate(el=>el.classList.contains('minimized')),false);
  await page.locator('#ptyClose').click();
  assert.equal(await page.locator('#ptyPanel').isVisible(),false);
  assert.equal(await page.locator('#ptyOpen').isVisible(),true);
  const stored=await page.evaluate(()=>localStorage.getItem('lightremote.g2.pty.layout.v1'));
  assert.ok(stored,'geometry saved locally');
  assert.ok(!stored.includes('G2_WIDGET_OUTPUT_VISIBLE'),'no transcript stored');
  await page.reload();
  await page.locator('#ptyOpen').click();
  rect=await panel.boundingBox();
  assert.ok(rect.x<oldX-80,'draggable location restored after reload');
  await page.setViewportSize({width:375,height:700});
  await sleep(150);
  rect=await panel.boundingBox();
  assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=375+1&&rect.y+rect.height<=700+1,'mobile viewport clamps panel');
  console.log('G2_PTY_FLOATING_CHROMIUM_DRAG_RESIZE_PERSIST=PASS');
  console.log('G2_PTY_FLOATING_CHROMIUM_MINIMIZE_AUTH_PRIVACY=PASS');
  console.log('G2_BACK_WALL_AND_PTY_OFFLINE_MATERIAL_ICONS=PASS');
} finally {
  if(browser)await browser.close();
  await wall.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
