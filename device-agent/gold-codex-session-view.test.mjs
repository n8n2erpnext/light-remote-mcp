import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createCodexSessionView} from './gold-codex-session-view.mjs';
const catalog=[{model:'fixture-fast',displayName:'Fast fixture',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Balanced'}]},
 {model:'fixture-deep',displayName:'Deep fixture',defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'More reasoning'},{reasoningEffort:'max',description:'Maximum'}]}];
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'lr-codex-view-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return {home,view:createCodexSessionView({home})};}
test('catalog selection persists and rejects unsupported or retired choices instead of silently switching',t=>{
 const {home,view}=fixture(t);view.updateAccount({type:'chatgpt',email:'fixture-a@example.invalid',planType:'plus'});view.applyModels(catalog);
 assert.deepEqual(view.selection(),{model:'fixture-fast',reasoningEffort:'medium'});
 assert.throws(()=>view.select({model:'fixture-deep',reasoningEffort:'medium'}),/unavailable/);
 view.select({model:'fixture-deep',reasoningEffort:'max'});
 const restored=createCodexSessionView({home});restored.applyModels(catalog);assert.equal(restored.selection().reasoningEffort,'max');
 view.applyModels(catalog.slice(0,1));assert.equal(view.selection().unavailable,true);assert.equal(view.selection().model,null);
 assert.doesNotMatch(fs.readFileSync(path.join(home,'light-remote-preferences.json'),'utf8'),/email|token|account/);
});
test('token counters accept only Bridge threads, deduplicate cumulative updates and retain unknown fields as unknown',t=>{
 const {view}=fixture(t);view.updateAccount({type:'chatgpt',email:'fixture-a@example.invalid'});view.applyModels(catalog);
 const total={totalTokens:40,inputTokens:30,cachedInputTokens:10,outputTokens:10,reasoningOutputTokens:4};
 const event={threadId:'thread-one',tokenUsage:{total,last:total}};
 view.ingestTokens(event);assert.equal(view.snapshot().usage.total,null);
 view.trackThread('thread-one',view.selection());view.ingestTokens(event);view.ingestTokens(event);
 assert.equal(view.snapshot().usage.total.totalTokens,40);
 view.ingestTokens({...event,tokenUsage:{last:total,total:{...total,totalTokens:20}}});assert.equal(view.snapshot().usage.total.totalTokens,40);
 view.trackThread('thread-two',view.selection());view.ingestTokens({...event,threadId:'thread-two'});assert.equal(view.snapshot().usage.total.totalTokens,80);
 view.updateAccount({type:'chatgpt',email:'fixture-b@example.invalid'});assert.equal(view.snapshot().usage.total,null);
});
test('quota and account tokens use reported values; missing or failed reads are not converted to zero',t=>{
 const {view}=fixture(t);assert.equal(view.snapshot().accountUsage.lifetimeTokens,null);
 view.applyRateLimits({rateLimitsByLimitId:{fixture:{limitName:'Fixture quota',primary:{usedPercent:37,windowDurationMins:300,resetsAt:1900000000}}}});
 view.applyAccountUsage({summary:{lifetimeTokens:0},dailyUsageBuckets:[{startDate:'2030-01-01',tokens:50}]});
 assert.equal(view.snapshot().quota.buckets[0].primary.usedPercent,37);assert.equal(view.snapshot().accountUsage.lifetimeTokens,0);
 view.unavailable('quota');assert.equal(view.snapshot().quota.state,'stale');assert.equal(view.snapshot().quota.buckets[0].primary.usedPercent,37);
 view.updateAccount(null);assert.equal(view.snapshot().quota.asOf,null);assert.equal(view.snapshot().accountUsage.lifetimeTokens,null);
});
test('corrupt optional preferences cannot prevent the Core Agent from starting',t=>{
 const {home}=fixture(t);fs.writeFileSync(path.join(home,'light-remote-preferences.json'),'{broken');
 const view=createCodexSessionView({home});view.applyModels(catalog);assert.equal(view.selection().unavailable,true);
 view.select({model:'fixture-fast',reasoningEffort:'medium'});assert.equal(view.selection().model,'fixture-fast');
});
