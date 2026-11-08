import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRc50AgentAction,rc50ActionTriageCatalog} from './rc50_agent_dispatch_triage.mjs';
const check=(type,op,expected)=>{
  const r=classifyRc50AgentAction({type,op});
  assert.equal(r.classification,expected);
  assert.equal(r.productionAuthorized,false);
  assert.equal(r.physicalExecutionAuthorized,false);
  assert.equal(r.epochRequired,true);
  assert.equal(r.deviceReceiptRequired,true);
  assert.equal(r.localLockRequired,true);
  assert.equal(r.actionSpecificReviewRequired,true);
  assert.equal(r.enforcementInstalled,false);
  return r;
};
const exec='NATIVE_EXECUTION_GUARD',ctl='NATIVE_CONTROL_GUARD',io='FILESYSTEM_MUTATION_GUARD',obs='OBSERVATION_AND_RECEIPT_REVIEW',manual='MANUAL_REVIEW_REQUIRED';
for(const [t,op,c] of [
  ['exec',undefined,exec],['update',undefined,ctl],['fs','read',manual],['fs','write',manual],
  ['terminal','start',exec],['terminal','input',exec],['terminal','signal',exec],['terminal','stop',exec],['terminal','resize',exec],['terminal','output',obs],['terminal','list',obs],
  ['process','start',exec],['process','input',exec],['process','stop',exec],['process','output',obs],['process','list',obs],
  ['scp','upload-begin',io],['scp','upload-chunk',io],['scp','upload-commit',io],['scp','download-begin',ctl],['scp','download-chunk',obs],['scp','cancel',ctl],['scp','status',obs],
  ['search','start',ctl],['search','cancel',ctl],['search','results',obs],
  ['desktop','run',exec],['desktop','attach',ctl],['desktop','detach',ctl],['desktop','live-open',ctl],['desktop','live-close',ctl],['desktop','windows',obs],['desktop','frame',obs],['desktop','observe',obs],['desktop','status',obs]
]){test(`${t}/${op??'(root)'} review lane`,()=>{const r=check(t,op,c);assert.equal(r.knownPath,c!==manual)})}
test('unknown type fails closed',()=>{assert.equal(check('danger','start',manual).reason,'UNKNOWN_LEAF_COMMAND_TYPE')});
test('unknown desktop action fails closed',()=>{assert.equal(check('desktop','unlock-screen',manual).reason,'UNREVIEWED_SUBOP')});
test('unknown terminal action fails closed',()=>{assert.equal(check('terminal','raw-fd',manual).knownPath,false)});
test('known op requires nonempty exact subop',()=>{assert.equal(check('process',undefined,manual).reason,'SUBOP_REQUIRED')});
test('invalid request shape fails closed',()=>{assert.equal(classifyRc50AgentAction(null).classification,manual)});
test('invalid action type fails closed',()=>{assert.equal(classifyRc50AgentAction({type:15}).classification,manual)});
test('ambiguous fs actions never get an automatic allow',()=>{for(const op of ['read','write','delete','mkdir','copy','move','chmod','list'])check('fs',op,manual)});
test('action catalog is detached from real executors',()=>{const cat=rc50ActionTriageCatalog();assert.equal(cat.terminal.exec.includes('input'),true);assert.equal(cat.desktop.exec.includes('run'),true)});
