// Actual Wall server + SQLite modules + retained log + browser/ANSI renderer.
// All identities, codes, commands and bytes are synthetic; no OpenAI request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {loadCanonicalEndpoints} from '../../../lib/canonical-endpoints.mjs';
const preferencePath=loadCanonicalEndpoints(new URL('../../../config/endpoints.json',import.meta.url)).routeCatalog.wallCodexPreferences.path;
import {startLocalWall} from '../../../device-agent/local-wall.mjs';
import {DeviceLocalActivityLog} from '../../../device-agent/local-activity-log.mjs';
import {createGoldWallModules} from '../../../device-agent/gold-wall-modules.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-wall-followup-'));
const out=process.env.LR_V4_VISUAL_OUT?path.join(process.env.LR_V4_VISUAL_OUT,'wall-followup'):path.resolve('visual-evidence/wall-followup');
fs.mkdirSync(out,{recursive:true});
const now=Date.now(),device='fixture-device',agent='plugin-'+'a'.repeat(34)+'bcd123',sessionId='s-fixture';
const catalog=[{model:'fixture-model',displayName:'Fixture model',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'Careful fixture'},{reasoningEffort:'max',description:'Deep fixture'}]}];
let connected=false,login=null,choice={model:'fixture-model',reasoningEffort:'high'},wall,browser,modules,terminalNumber=1,remoteEvents=[];
const terminalId=()=> 'ltm_'+String(terminalNumber).repeat(24);
const terminalText=()=>terminalNumber===1?'\x1b[2J\x1b[32;100HCONPTY_EDGE_120x32\x1b[?25h':'\x1b[32mNEW_TERMINAL_OUTPUT\x1b[0m\r\n';
const session=()=>({account:{state:'ready',connected,plan:connected?'plus':null},login,
 catalog:{state:'ready',asOf:now,models:catalog},selection:choice,
 quota:{state:'ready',asOf:now,buckets:[{id:'fixture',name:'Fixture quota',primary:{usedPercent:37,windowDurationMins:300,resetsAt:1900000000},secondary:null}]},
 accountUsage:{state:'ready',asOf:now,lifetimeTokens:12345,daily:[]},
 usage:{state:'not_reported',asOf:null,total:null,last:null,model:null,reasoningEffort:null}});
const code={state:'pending',userCode:'CODE-TEST',verificationUrl:'https://auth.openai.com/codex/device'};
const plus={snapshot:session,account:async()=>({connected,authMode:'chatgpt',plan:connected?'plus':null,login,session:session()}),
 beginLogin:async()=>{login=code;return code;},cancelLogin:async()=>{login=null;return {cancelled:true};},
 logout:async()=>{connected=false;login=null;return {signedOut:true};},
 preferences:async input=>{assert.equal(input.model,'fixture-model');assert.ok(['high','max'].includes(input.reasoningEffort));choice=input;return choice;},stop(){}};
const activity=(i,long=false)=>[
 {id:'start-'+i,jobId:'job-'+i,sessionId,agentId:agent,type:'job_started',status:'running',at:new Date(now+i).toISOString(),script:long?'SYNTHETIC_LONG_SCRIPT\n'+Array.from({length:60},(_,n)=>'echo synthetic-line-'+n).join('\n'):'echo synthetic-'+i,requiredCapabilities:long?['systemctl']:[]},
 {id:'finish-'+i,jobId:'job-'+i,sessionId,agentId:agent,type:'job_finished',status:'ok',at:new Date(now+i+1).toISOString(),exitCode:0}
];
const seed=new DeviceLocalActivityLog({root:path.join(root,'logs'),deviceId:device});
for(let i=1;i<=800;i++)for(const e of activity(i))seed.add(e);
seed.close();
const results=[],errors=[];
try{
 modules=createGoldWallModules({file:path.join(root,'modules.sqlite'),plusImpl:plus});modules.configure({longMemory:false,codexBridge:true,expectedRevision:0});
 wall=startLocalWall({host:'127.0.0.1',port:0,modules,activityLogRoot:path.join(root,'logs'),
  auth:{enabled:true,identity:()=>({username:'fixture@example.invalid'}),csrfForRequest:()=> 'fixture-csrf',verifyRequestCsrf:(_req,value)=>value==='fixture-csrf'},
  getLocalStatus:async()=>({deviceId:device,deviceName:'Fixture PC',enrolled:true,cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>({access:{activeGrants:[{agentId:agent,label:agent,expiresAt:Date.now()+3600000}]},sessions:[{sessionId,agentId:agent,nickname:'Fixture assistant',state:'active'}]}),
  getRemoteActivity:async()=>({events:remoteEvents.slice(-500)}),
  getLocalTerminals:async()=>[{terminalId:terminalId(),sessionId,shell:'powershell',state:'running',cols:120,rows:32,outputBytes:Buffer.byteLength(terminalText())}],
  readLocalTerminal:async(id,{offset})=>{if(id!==terminalId())throw Error('terminal_not_found');const b=Buffer.from(terminalText());return {terminalId:id,state:'running',cols:120,rows:32,output:{text:b.subarray(offset).toString(),nextOffset:b.length,totalBytes:b.length}};}
 });
 if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
 const base='http://127.0.0.1:'+wall.server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.LR_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.LR_PLAYWRIGHT_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await page.goto(base+'/codex-cli');await page.locator('#goldCodexPlusLogin').click();
 await page.waitForFunction(()=>document.getElementById('goldCodexPlusCode').value==='CODE-TEST');
 assert.equal(await page.locator('#goldCodexPlusCode').getAttribute('readonly'),'');
 await page.locator('#goldCodexPlusCopy').click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'CODE-TEST');
 connected=true; // Deliberately leave a stale pending login in the response.
 await page.waitForFunction(()=>document.getElementById('goldCodexPlusDevice').hidden,{timeout:12000});
 assert.equal(await page.locator('#goldCodexPlusCode').inputValue(),'');
 const saved=page.waitForResponse(response=>new URL(response.url()).pathname===preferencePath&&response.request().method()==='POST');
 await page.locator('#goldCodexEffort').selectOption('max');
 const savedResponse=await saved;assert.equal(savedResponse.ok(),true);
 await page.waitForFunction(()=>document.getElementById('goldCodexEffort').value==='max');
 assert.equal(choice.reasoningEffort,'max');assert.match(await page.locator('#goldCodexMetrics').textContent(),/37% used/);
 results.push('Codex selectable/copy code, automatic connected cleanup, catalog/effort preferences and reported usage');
 await page.goto(base);await page.waitForFunction(()=>document.querySelectorAll('#jobs .job').length>0);
 assert.match(await page.locator('.ab-grant-agent-row').textContent(),/^bcd123 · /);
 assert.ok(!(await page.locator('.ab-grant-agent-row').textContent()).includes('plugin-'));
 // Keep ingesting after the old200 ceiling, with real SSE polling and disk writes.
 for(let wave=0;wave<3;wave++){
  const begin=801+wave*120;for(let i=begin;i<begin+120;i++)remoteEvents.push(...activity(i));
  await page.waitForFunction(id=>document.getElementById('j-'+id), 'job-'+(begin+119),{timeout:12000});
 }
 assert.ok(await page.locator('#jobs .job').count()<=300);assert.match(await page.locator('#stats').textContent(),/in this view/);
 let oldest=false;
 for(let i=0;i<12;i++){
  if(await page.locator('#j-job-1').count()){oldest=true;break;}
  if(await page.locator('#wallHistoryOlder').isDisabled())break;
  const prior=await page.evaluate(()=>wallHistoryPageCursor);await page.locator('#wallHistoryOlder').click();
  await page.waitForFunction(old=>!wallHistoryBusy&&wallHistoryPageCursor!==old,prior);
 }
 assert.ok(oldest,'oldest retained job must remain reachable beyond800 jobs');
 remoteEvents.push(...activity(1161));await page.waitForTimeout(2800);
 await page.locator('#wallHistoryLive').click();await page.waitForFunction(()=>!!document.getElementById('j-job-1161'));
 results.push('SSE advances past200; bounded moving view; oldest retained job, new arrival during history and return-to-live');
 remoteEvents.push(...activity(1162,true));await page.waitForFunction(()=>!!document.getElementById('j-job-1162'),null,{timeout:12000});
 for(const width of [1440,1024,853,390]){
  await page.setViewportSize({width,height:1000});
  const geometry=await page.locator('#j-job-1162').evaluate(el=>{
   const b=el.querySelector('.commandbadges').getBoundingClientRect(),c=el.querySelector('.cmdtext').getBoundingClientRect(),lead=el.querySelector('.joblead').getBoundingClientRect();
   return {badgesAbove:b.bottom<=c.top+1,leadTop:lead.top,badgeTop:b.top,overflow:document.documentElement.scrollWidth>innerWidth+3};
  });
  assert.ok(geometry.badgesAbove&&!geometry.overflow,JSON.stringify(geometry));if(width>800)assert.ok(Math.abs(geometry.badgeTop-geometry.leadTop)<8);
 }
 results.push('COMMAND/DANGER badges remain on their own first row at four widths, including multiline SSE updates');
 await page.setViewportSize({width:1440,height:1000});await page.locator('#ptyOpen').click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label=\"Read-only terminal text transcript\"]').value.includes('CONPTY_EDGE_120x32'));
 const grid=await page.evaluate(()=>({cols:ptyTerm.cols,rows:ptyTerm.rows,line:ptyTerm.buffer.active.getLine(31).translateToString(true)}));
 assert.equal(grid.cols,120);assert.equal(grid.rows,32);assert.ok(grid.line.includes('CONPTY_EDGE_120x32'));
 for(const action of ['close','minimize']){
  await page.locator(action==='close'?'#ptyClose':'#ptyMinimize').click();await page.locator(action==='close'?'#ptyOpen':'#ptyMinimize').click();
  await page.waitForFunction(()=>document.querySelector('textarea[aria-label=\"Read-only terminal text transcript\"]').value.includes('CONPTY_EDGE_120x32'));
 }
 terminalNumber=2;await page.locator('#ptyRefresh').click();
 await page.waitForFunction(()=>document.querySelector('textarea[aria-label=\"Read-only terminal text transcript\"]').value.includes('NEW_TERMINAL_OUTPUT'));
 assert.ok(!(await page.locator('textarea[aria-label=\"Read-only terminal text transcript\"]').inputValue()).includes('CONPTY_EDGE'));
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+3));
 await page.screenshot({path:path.join(out,'pty-narrow.png')});
 results.push('PTY producer grid, bottom-right ANSI output, transcript, close/reopen/minimize, replacement session and narrow containment');
 assert.deepEqual(errors,[]);
 console.log('WALL_FOLLOWUP_BROWSER_PASS '+JSON.stringify(results));
}finally{
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({scope:'Synthetic actual-server browser regression; not physical Owner acceptance',results,errors},null,2)+'\n');
 await browser?.close();await wall?.close();modules?.close();fs.rmSync(root,{recursive:true,force:true});
}
