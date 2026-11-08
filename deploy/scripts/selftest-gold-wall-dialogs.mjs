import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';
import {localProcessPage} from '../../device-agent/local-process-page.mjs';
import {updateSettingsHtml} from '../../device-agent/update-settings-page.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require('/home/ubuntu/node_modules/playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-wall-modal-'));
const modules=createGoldWallModules({file:path.join(dir,'modules.sqlite')});
let wall,browser;
try{
  modules.configure({longMemory:true,codexBridge:true,expectedRevision:0});
  const auth={enabled:true,identity:req=>req.headers['x-owner']==='yes'?{username:'test-owner'}:null,
    csrfForRequest:()=> 'modal-fixture-csrf',verifyRequestCsrf:(_r,v)=>v==='modal-fixture-csrf'};
  wall=startLocalWall({host:'127.0.0.1',port:0,modules,auth,getLocalStatus:async()=>({deviceName:'Gold UAT dialog fixture'})});
  await new Promise((ok,bad)=>wall.server.listening?ok():wall.server.once('listening',ok).once('error',bad));
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({extraHTTPHeaders:{'x-owner':'yes'}});
  const native=[];
  page.on('dialog',d=>{native.push(d.type());void d.dismiss();});
  await page.goto('http://127.0.0.1:'+wall.server.address().port+'/long-memory',{waitUntil:'domcontentloaded'});
  await page.locator('#confirmOverlay').waitFor({state:'attached'});
  const prom=page.evaluate(()=>wallPrompt('Type exact scope name:',''));
  await page.locator('#confirmOverlay.show #confirmInput').waitFor();
  await page.locator('#confirmInput').fill('Synthetic G3 scope');
  await page.locator('#confirmOk').click();
  assert.equal(await prom,'Synthetic G3 scope');
  const confirm=page.evaluate(()=>confirmAction('Review Codex receipt and approve DONE?'));
  await page.locator('#confirmOverlay.show').waitFor();
  await page.locator('#confirmCancel').click();
  assert.equal(await confirm,false);
  const esc=page.evaluate(()=>wallPrompt('Delete scope?'));
  await page.locator('#confirmOverlay.show #confirmInput').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await esc,null);
  const accepted=page.evaluate(()=>confirmAction('Archive scope safely?'));
  await page.locator('#confirmOverlay.show').waitFor();
  await page.locator('#confirmOk').click();
  assert.equal(await accepted,true);
  assert.equal(native.length,0,'No Chrome native dialogs permitted in Gold Wall');
  assert.equal(await page.locator('#confirmOverlay.show').count(),0);
  console.log('GOLD_WALL_NATIVE_DIALOG_FREE_PROMPT_CONFIRM_CANCEL_ESCAPE_PASS');
  for(const [name,html] of [
    ['Fleet jobs',fleetJobPage({csrfToken:'fixture'})],
    ['Processes',localProcessPage('fixture')],
    ['Update settings',updateSettingsHtml({surface:'local',csrfToken:'fixture',modulesAvailable:true})]
  ]){
    const secondary=await browser.newPage();
    const dialogs=[];
    secondary.on('dialog',d=>{dialogs.push(d.type());void d.dismiss();});
    await secondary.setContent(html,{waitUntil:'domcontentloaded'});
    const decision=secondary.evaluate(()=>wallConfirm('Remove a disposable example?'));
    await secondary.locator('#wallDialogBackdrop:not([hidden])').waitFor();
    await secondary.locator('#wallDialogCancel').click();
    assert.equal(await decision,false,name+' cancel');
    assert.equal(dialogs.length,0,name+' must not call native Chrome dialogs');
    await secondary.close();
  }
  console.log('GOLD_SECONDARY_WALL_FLEET_PROCESS_UPDATE_CUSTOM_DIALOGS_PASS');
}finally{
  await browser?.close().catch(()=>{});
  await wall?.close().catch(()=>{});
  modules.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
