import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {createPlatformAdapter} from '../../device-agent/platform-adapters/index.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';
const mod=await import('playwright').catch(()=>null);
if(!mod||!fs.existsSync(mod.chromium.executablePath())){console.log('GOLD_PERMISSIONS_GROUPS_BROWSER=SKIPPED (Playwright unavailable)');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-permission-groups-'));
const authFile=path.join(dir,'auth.json');
writeLocalWallAuthConfig(authFile,{username:'owner',password:'fixture-gold-permissions-password',sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(authFile,{required:true});
const port=29000+(process.pid%20000);
const caps=['filesystem','git','build-test','terminal','desktop','desktop-input','docker','lxd','network-admin','firewall','macos-log','other-vendor-plugin'];
let status={deviceId:'dev_test',deviceName:'Gold MultiOS Fixture',policyAuthority:'server-and-local',policyRevision:3,grantableCapabilities:caps,approvedCapabilities:caps.filter(c=>c!=='docker'),installedCapabilities:['git'],deniedCapabilities:['terminal','desktop-input','firewall'],localPolicyProfile:'custom'};
const saves=[];
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,auth,
 getLocalStatus:async()=>status,getLocalPolicyStatus:async()=>status,
 setPermissions:async input=>{saves.push(input);status={...status,deniedCapabilities:caps.filter(c=>!input.allowedCapabilities.includes(c)),localPolicyProfile:input.profile};return {profile:input.profile,effectiveCapabilities:caps.filter(c=>input.allowedCapabilities.includes(c)&&status.approvedCapabilities.includes(c))};}
});
let browser;const base='http://127.0.0.1:'+port;
try{
 browser=await mod.chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1250,height:950}});
 const browserErrors=[];
 page.on('pageerror',err=>browserErrors.push(String(err)));
 await page.goto(base+'/login');await page.locator('input[name=username]').fill('owner');
 await page.locator('input[name=password]').fill('fixture-gold-permissions-password');
 await page.locator('button[type=submit]').click();
 await page.waitForURL(base+'/');
 await page.goto(base+'/permissions');
 await page.locator('details[data-permission-group=pty]').waitFor();
 const values=await page.locator('input[data-cap]').evaluateAll(list=>list.map(node=>node.value));
 assert.equal(values.length,caps.length,'all OS and future permissions visible');
 assert.equal(new Set(values).size,values.length,'no duplicate capability toggles');
 for(const group of ['core','pty','remote','containers','network','os','other']){
   assert.equal(await page.locator('details[data-permission-group='+group+']').count(),1,group+' group visible');
 }
 assert.equal(await page.locator('details[data-permission-group=pty] input[data-cap]').count(),1,'PTY is exactly one toggle');
 assert.deepEqual(await page.locator('details[data-permission-group=remote] input[data-cap]').evaluateAll(els=>els.map(e=>e.value).sort()),['desktop','desktop-input'],'RM view/input separate');
 assert.equal(await page.locator('input[data-cap][value=terminal]').isChecked(),false);
 await page.locator('details[data-permission-group=pty] input[data-group=pty]').check();
 assert.equal(await page.locator('input[data-cap][value=terminal]').isChecked(),true,'PTY group enables terminal');
 assert.equal(await page.locator('input[data-cap][value=desktop-input]').isChecked(),false,'PTY does not toggle RM input');
 await page.locator('#profile').selectOption('support');
 assert.equal(await page.locator('input[data-cap][value=desktop]').isChecked(),true);
 assert.equal(await page.locator('input[data-cap][value=desktop-input]').isChecked(),true);
 assert.equal(await page.locator('input[data-cap][value=terminal]').isChecked(),false,'support profile leaves PTY off');
 await page.locator('#save').click();
 await page.locator('#status.ok').waitFor();
 assert.equal(saves.at(-1).profile,'support','profile persists using existing policy API');
 assert(saves.at(-1).allowedCapabilities.includes('desktop-input'));
 assert(!saves.at(-1).allowedCapabilities.includes('terminal'));
 assert.equal(await page.locator('input[data-cap][value=docker]').count(),1);
 assert(await page.locator('details[data-permission-group=containers] .perm-chip.pending').count()>=1,'server approval visible');
 await page.reload();
 assert.equal(await page.locator('#profile').inputValue(),'support');
 assert.equal(await page.locator('details[data-permission-group=remote] input[data-cap]').count(),2);
 for(const platform of ['linux','darwin','win32']){
   const adapter=createPlatformAdapter({platform,commandExists:()=>false});
   const catalog=[...new Set([...adapter.discoverCapabilities(),'desktop','desktop-input'])];
   status={...status,deviceName:platform+' permission fixture',platformAdapter:platform,grantableCapabilities:catalog,approvedCapabilities:catalog,installedCapabilities:[],deniedCapabilities:['terminal'],localPolicyProfile:'custom'};
   await page.reload();
   await page.locator('details[data-permission-group=pty]').waitFor();
   const visible=await page.locator('input[data-cap]').evaluateAll(els=>els.map(e=>e.value));
   assert.equal(visible.length,catalog.length,platform+' shows complete catalog');
   assert.equal(new Set(visible).size,catalog.length,platform+' has no duplicate capabilities');
   assert.deepEqual([...visible].sort(),[...catalog].sort(),platform+' covered all platform capabilities');
   assert.equal(await page.locator('details[data-permission-group=pty] input[data-cap]').count(),1,platform+' keeps PTY separate');
   assert.equal(await page.locator('details[data-permission-group=remote] input[data-cap]').count(),2,platform+' keeps view/input separate');
 }
 assert.equal(browserErrors.length,0,'browser page errors: '+browserErrors.join('; '));
 console.log('GOLD_PERMISSION_GROUPS_BROWSER_PASS eight_groups,pty_independent,rm_view_input,profiles,future_fallback,server_ceiling,no_duplicates,persist');
}finally{await browser?.close().catch(()=>{});await new Promise(resolve=>wall.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
