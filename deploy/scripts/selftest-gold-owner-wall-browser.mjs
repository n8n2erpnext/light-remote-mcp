import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeAccountOnlyWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';
const pw='fixture-password-not-stored';const email='owner@fixture.example';
const playwright=await import('playwright').catch(()=>null);
if(!playwright||!fs.existsSync(playwright.chromium.executablePath())){console.log('GOLD_OWNER_WALL_BROWSER_SKIPPED no_chromium');process.exit(0)}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-owner-wall-'));
const filename=path.join(dir,'auth.json');
writeAccountOnlyWallAuthConfig(filename);
const auth=loadLocalWallAuth(filename,{required:true}),port=30000+(process.pid%20000),base='http://127.0.0.1:'+port;
const caps=['filesystem','git','build-test','terminal','lxd','docker','kubernetes'];
let saved=[],approved=['filesystem','git','build-test','terminal','lxd'],denied=['docker','kubernetes'],ownerCalls=0;
const current=()=>({deviceId:'dev_fixture',deviceName:'Gold Owner Fixture',policyAuthority:'server-and-local',policyRevision:1,
 supportedCapabilities:caps,grantableCapabilities:caps,approvedCapabilities:approved,localRequestedCapabilities:saved,
 installedCapabilities:['git'],deniedCapabilities:denied,localPolicyProfile:'custom'});
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,auth,
 getLocalStatus:async()=>current(),getLocalPolicyStatus:async()=>current(),
 accountAuthenticate:async({username,password})=>{if(username!==email||password!==pw)throw Error('invalid_account_credentials');return {account:{accountId:'acct_fixture',email}};},
 setPermissions:async({allowedCapabilities,profile})=>{saved=allowedCapabilities;denied=caps.filter(c=>!saved.includes(c));return {profile,effectiveCapabilities:saved.filter(c=>approved.includes(c))}},
 ownerApprovePermissions:async({email:verifiedEmail,password,approvedCapabilities})=>{ownerCalls++;assert.equal(verifiedEmail,email);if(password!==pw)throw Error('invalid_account_credentials');approved=[...approvedCapabilities];return {policyRevision:2,approvedCapabilities:approved,effectiveCapabilities:approved.filter(c=>!denied.includes(c))}}
});
let browser;try{
 browser=await playwright.chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',err=>errors.push(String(err)));
 await page.goto(base+'/login?next=%2Fpermissions');
 await page.locator('input[name=username]').fill(email);
 await page.locator('input[name=password]').fill(pw);
 await page.locator('button[type=submit]').click();
 await page.waitForURL(base+'/permissions');
 await page.locator('details[data-permission-group=containers]').waitFor();
 await page.locator('details[data-permission-group=containers] summary').click();
 await page.locator('input[data-cap][value=docker]').waitFor();
 assert.equal(await page.locator('#serverApproval').isVisible(),false);
 await page.locator('input[data-cap][value=docker]').check();
 assert.equal(await page.locator('#serverApproval').isVisible(),true);
 await page.locator('#owner-password').fill('wrong');
 await page.locator('#approve-server').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('invalid_account_credentials'));
 assert(!approved.includes('docker'),'wrong credential cannot authorize');
 await page.locator('#owner-password').fill(pw);
 await page.locator('#approve-server').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Owner-approved server policy revision'));
 assert(approved.includes('docker'),'owner-authorized capability now effective');
 assert.equal(ownerCalls,2);
 assert.equal(await page.locator('#owner-password').inputValue(),'');
 assert.equal(await page.locator('#serverApproval').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('GOLD_OWNER_WALL_BROWSER_PASS account_only_login,csrf,wrong_password_rejected,owner_approval,local_save,server_effective');
}finally{await browser?.close().catch(()=>{});await new Promise(resolve=>wall.server.close(resolve));fs.rmSync(dir,{recursive:true,force:true})}
