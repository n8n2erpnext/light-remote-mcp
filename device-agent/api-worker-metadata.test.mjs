import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createGoldCodexPlus} from './gold-codex-plus.mjs';
import {createCodexSessionView} from './gold-codex-session-view.mjs';
const catalog=[{model:'fixture-model',displayName:'Fixture model',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Balanced'}]}];
class MetadataServer extends EventEmitter{
 constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.killed=false;this.calls=[];this.owner='account-a';this.used=31;this.failQuota=false;this.holdQuota=false;this.held=[];
  this.stdin=new Writable({write:(chunk,encoding,done)=>{for(const row of chunk.toString().trim().split('\n')){const msg=JSON.parse(row);this.calls.push(msg.method);if(msg.id)queueMicrotask(()=>this.reply(msg));}done();}});
 }
 notify(method,params={}){this.stdout.write(JSON.stringify({method,params})+'\n');}
 reply(msg){
  let result;
  if(msg.method==='initialize')result={serverInfo:{name:'fixture'}};
  else if(msg.method==='account/read')result={account:{type:'chatgpt',id:this.owner,email:this.owner+'@invalid.test',planType:'plus'}};
  else if(msg.method==='model/list')result=this.loopModels?{data:[],nextCursor:'same-cursor'}:{data:catalog,nextCursor:null};
  else if(msg.method==='account/rateLimits/read'){
   if(this.holdQuota){this.holdQuota=false;this.held.push(()=>this.send(msg,{rateLimits:{limitId:'codex',primary:{usedPercent:7,windowDurationMins:300}}}));return;}
   if(this.failQuota){this.failQuota=false;this.stdout.write(JSON.stringify({id:msg.id,error:{message:'fixture_quota_unavailable'}})+'\n');return;}
   result={rateLimits:{limitId:'codex',primary:{usedPercent:this.used,windowDurationMins:300,resetsAt:1900000000}}};
  }else if(msg.method==='account/usage/read')result={summary:{lifetimeTokens:123},dailyUsageBuckets:[]};
  else if(this.review&&msg.method==='config/read'){
   result={config:this.reviewConfig??{}};
  }else if(this.review&&msg.method==='thread/start'){
   this.threadParams=msg.params;
   result={thread:{id:'review-thread'},model:'fixture-model',modelProvider:'openai',approvalPolicy:'never',instructionSources:[],
    sandbox:{type:this.wrongSandbox?'workspaceWrite':'readOnly'}};
  }else if(this.review&&msg.method==='turn/start'){
   this.turnParams=msg.params;
   this.send(msg,{turn:{id:'review-turn'}});
   if(!this.holdTurn){
    this.notify('item/agentMessage/delta',{threadId:'review-thread',turnId:'review-turn',delta:'A useful review.'});
    this.notify('turn/completed',{threadId:'review-thread',turn:{id:'review-turn',status:'completed'}});
   }
   return;
  }else if(this.review&&msg.method==='turn/interrupt'){
   this.interruptParams=msg.params;
   this.send(msg,{});
   this.notify('turn/completed',{threadId:'review-thread',turn:{id:'review-turn',status:'interrupted'}});
   return;
  }else if(this.review&&msg.method==='thread/unsubscribe')result={status:'unsubscribed'};
  else throw Error('Unexpected non-metadata RPC '+msg.method);
  this.send(msg,result);
 }
 send(msg,result){this.stdout.write(JSON.stringify({id:msg.id,result})+'\n');}
 kill(){this.killed=true;this.emit('exit',0);}
}
const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('fixture_timeout');};
function fixture(t,options={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'lr-worker-metadata-')),fake=new MetadataServer();let spawns=0;
 const client=createGoldCodexPlus({home,command:process.execPath,metadataEnabled:options.metadataEnabled??(()=>true),spawnImpl:()=>{spawns++;return fake;}});
 t.after(()=>{client.stop();fs.rmSync(home,{recursive:true,force:true});});return {client,fake,spawns:()=>spawns};
}
test('enabled read warmup is single-flight metadata only; forced refresh bypasses successful TTL',async t=>{
 const {client,fake,spawns}=fixture(t);client.warmup();client.warmup();
 await wait(()=>client.snapshot().quota.state==='ready');
 assert.equal(spawns(),1);assert.equal(client.snapshot().selection.model,'fixture-model');
 const count=method=>fake.calls.filter(m=>m===method).length;
 assert.equal(count('account/rateLimits/read'),1);await client.account();assert.equal(count('account/rateLimits/read'),1);
 fake.used=42;await client.account({force:true});assert.equal(count('account/rateLimits/read'),2);assert.equal(client.snapshot().quota.buckets[0].primary.remainingPercent,58);
 assert.ok(fake.calls.every(m=>['initialize','initialized','account/read','model/list','account/rateLimits/read','account/usage/read'].includes(m)));
 assert.doesNotMatch(JSON.stringify(client.snapshot()),/account-a|@invalid/);
});
test('failed metadata stays unknown; explicit force retries immediately without a false 30-second success cache',async t=>{
 const {client,fake}=fixture(t);fake.failQuota=true;await client.account();assert.equal(client.snapshot().quota.state,'unavailable');
 fake.used=19;await client.account({force:true});assert.equal(client.snapshot().quota.buckets[0].primary.usedPercent,19);
});
test('disabled provider never warms or refreshes metadata from account notifications',async t=>{
 let enabled=false;const {client,fake,spawns}=fixture(t,{metadataEnabled:()=>enabled});
 client.warmup();await Promise.resolve();assert.equal(spawns(),0);
 enabled=true;client.warmup();await wait(()=>client.snapshot().quota.state==='ready');
 const count=fake.calls.length;enabled=false;fake.notify('account/updated');await new Promise(r=>setTimeout(r,10));
 assert.equal(fake.calls.length,count);assert.equal(client.snapshot().quota.buckets.length,0);
});
test('non-advancing model cursor fails closed after bounded reads',async t=>{
 const {client,fake}=fixture(t);fake.loopModels=true;await client.account();
 assert.equal(client.snapshot().catalog.state,'unavailable');assert.equal(fake.calls.filter(x=>x==='model/list').length,2);
});
test('account notification invalidates pending old metadata and warms the new identity without mixing buckets',async t=>{
 const {client,fake}=fixture(t);fake.holdQuota=true;const first=client.account();await wait(()=>fake.held.length===1);
 fake.owner='account-b';fake.used=83;fake.notify('account/updated');assert.equal(client.snapshot().account.connected,false);assert.equal(client.snapshot().quota.buckets.length,0);
 fake.held.shift()();await first;await wait(()=>client.snapshot().quota.buckets[0]?.primary?.usedPercent===83);
 assert.equal(client.snapshot().account.connected,true);assert.doesNotMatch(JSON.stringify(client.snapshot()),/account-a|account-b|@invalid/);
});
test('partial token notifications retain known fields and never invent missing fields or double count',t=>{
 const {view}=(()=>{const home=fs.mkdtempSync(path.join(os.tmpdir(),'lr-partial-token-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {view:createCodexSessionView({home})};})();
 view.updateAccount({type:'chatgpt',id:'a'});view.trackThread('owned',{model:'fixture-model'});
 const p={threadId:'owned',tokenUsage:{total:{inputTokens:10,outputTokens:3},last:{outputTokens:3}}};
 view.ingestTokens(p);view.ingestTokens(p);
 assert.equal(view.snapshot().usage.total.inputTokens,10);assert.equal(view.snapshot().usage.total.outputTokens,3);assert.equal(view.snapshot().usage.total.totalTokens,null);assert.equal(view.snapshot().usage.last.outputTokens,3);assert.equal(view.snapshot().usage.state,'partial');
 view.ingestTokens({...p,threadId:'foreign'});assert.equal(view.snapshot().usage.total.inputTokens,10);
});
test('single-bucket notifications merge without discarding other buckets or unreported windows; timestamps stay per window',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'lr-quota-merge-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));let at=100;
 const view=createCodexSessionView({home,now:()=>at});
 view.applyRateLimits({rateLimitsByLimitId:{a:{primary:{usedPercent:31,windowDurationMins:300},secondary:{usedPercent:41,windowDurationMins:10080}},b:{primary:{usedPercent:5,windowDurationMins:60}}}});
 at=200;view.applyRateLimits({rateLimits:{limitId:'a',primary:{usedPercent:32,windowDurationMins:300}}},{replace:false});
 const q=view.snapshot().quota;assert.equal(q.buckets.length,2);assert.equal(q.buckets[0].primary.remainingPercent,68);assert.equal(q.buckets[0].secondary.asOf,100);assert.equal(q.buckets[1].primary.asOf,100);assert.equal(q.buckets[0].primary.asOf,200);
 view.disconnected();assert.equal(view.snapshot().quota.buckets.length,0);assert.equal(view.snapshot().account.plan,null);
});
test('worker review carries only approved text and denies unverified provider configuration',async t=>{
 const {client,fake}=fixture(t);fake.review=true;
 const signal=new AbortController().signal;
 const input={prompt:'Review this layout',context:'Verified text',model:'fixture-model',timeoutMs:10000,signal,verify:async()=>{}};
 fake.reviewConfig={mcp_servers:{external:{}}};
 await assert.rejects(client.runWorkerReview(input),/codex_review_policy_unverified/);
 assert.equal(fake.calls.includes('thread/start'),false);
 fake.reviewConfig={};fake.wrongSandbox=true;
 await assert.rejects(client.runWorkerReview(input),/codex_review_policy_unverified/);
 assert.equal(fake.calls.includes('turn/start'),false);
 fake.wrongSandbox=false;
 await assert.rejects(client.runWorkerReview({...input,verify:async()=>{throw Error('grant_revoked');}}),/grant_revoked/);
 assert.equal(fake.calls.includes('turn/start'),false);
 assert.deepEqual(await client.runWorkerReview(input),{text:'A useful review.',model:'fixture-model'});
 assert.equal(fake.threadParams.config['features.shell_tool'],false);
 assert.equal(fake.threadParams.config['features.multi_agent'],false);
 assert.equal(fake.threadParams.ephemeral,true);
 assert.equal(fake.turnParams.sandboxPolicy.access.type,'restricted');
 assert.deepEqual(JSON.parse(fake.turnParams.input[0].text),{request:input.prompt,reference:input.context});
});
test('worker abort interrupts its own Codex thread and turn',async t=>{
 const {client,fake}=fixture(t);fake.review=true;fake.holdTurn=true;
 const controller=new AbortController();
 const running=client.runWorkerReview({prompt:'Review',context:'',model:'fixture-model',
  timeoutMs:10000,signal:controller.signal,verify:async()=>{}});
 const refused=assert.rejects(running,/codex_review_incomplete/);
 await wait(()=>fake.turnParams);
 controller.abort();
 await refused;
 assert.deepEqual(fake.interruptParams,{threadId:'review-thread',turnId:'review-turn'});
 assert.equal(fake.killed,false);
});
