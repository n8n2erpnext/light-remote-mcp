import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const src=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
const start=src.indexOf('function createGoldWallModuleController({');
const end=src.indexOf('let goldModuleChannel=null;',start);
assert.ok(start>0&&end>start,'extract actual Wall client state implementation');
const factory=vm.runInNewContext(src.slice(start,end)+'\ncreateGoldWallModuleController',
 {location:{origin:'http://127.0.0.1:5491'},AbortController,Promise,Error,String,Number});
let persisted={revision:13,longMemory:false,codexBridge:true};
let owner='owner@example.invalid',sets=0,committed=0;
const errors=[],render=[],changed=[];
const make=(get,put)=>factory({
 load:get,configure:put,
 apply:(s,pending)=>render.push({revision:s?.revision??null,memory:s?.longMemory??null,pending}),
 onPending:()=>{},onError:e=>errors.push(String(e.message||e)),
 onCommitted:async()=>{committed++;throw Error('child_pane_unavailable');},
 onChanged:identity=>changed.push(identity)
});
const clone=()=>({ok:true,ownerIdentity:owner,modules:{...persisted}});
const put=async body=>{
 sets++;
 if(body.expectedRevision!==persisted.revision)throw Error('gold_modules_revision_conflict');
 persisted={revision:persisted.revision+1,longMemory:body.longMemory,codexBridge:body.codexBridge};
 return {ok:true,modules:{...persisted}};
};
// Simulate out-of-order HTTP responses: rev14 ON wins, old rev13 OFF ignored.
const calls=[];
const a=make(()=>new Promise(resolve=>calls.push(resolve)),put);
const slow=a.refresh(),fast=a.refresh();
assert.equal(calls.length,2);
calls[1]({ok:true,ownerIdentity:owner,modules:{revision:14,longMemory:true,codexBridge:true}});
await fast;
calls[0]({ok:true,ownerIdentity:owner,modules:{revision:13,longMemory:false,codexBridge:true}});
await slow;
assert.equal(a.value().revision,14);
assert.equal(a.value().longMemory,true);
// Symmetric OFF action is immediate persisted CAS; while POST in flight double click is ignored.
persisted={revision:14,longMemory:true,codexBridge:true};
const pending=a.set('longMemory',false);
assert.equal(a.isPending(),true);
assert.equal(render.at(-1).pending,true,'pending must disable both Enable/Disable controls');
assert.equal(await a.set('longMemory',false),false);
assert.equal(sets,1);
await pending;
assert.equal(a.value().longMemory,false);
assert.equal(a.value().codexBridge,true,'toggle preserves other module');
assert.equal(a.value().revision,15,'persisted mutation must advance revision');
assert.equal(a.isPending(),false);
// New tab B opens at revision14; A turns ON to rev15; B does not re-send stale mutation.
persisted={revision:14,longMemory:false,codexBridge:true};
const tabA=make(async()=>clone(),put);
const tabB=make(async()=>clone(),put);
await tabA.refresh();await tabB.refresh();
assert.equal(tabA.value().revision,14);
assert.equal(tabB.value().revision,14);
assert.equal(await tabA.set('longMemory',true),true);
assert.equal(persisted.revision,15);
assert.equal(await tabB.set('codexBridge',false),false,'409 conflicts, no automatic retry');
assert.equal(tabB.value().revision,15,'re-read persisted revision after 409');
assert.equal(tabB.value().longMemory,true);
assert.equal(tabB.value().codexBridge,true);
assert.equal(persisted.codexBridge,true);
assert.ok(errors.includes('gold_modules_revision_conflict'));
const before=sets;
await tabB.set('codexBridge',false);
assert.equal(sets,before+1,'only explicit second Owner click may submit new mutation');
assert.equal(tabB.value().revision,16);
assert.equal(tabB.value().codexBridge,false);
assert.equal(persisted.longMemory,true);
// Other-tab invalidation is only a refetch request: no external payload writes to state.
assert.match(src,/type:'modules-invalidated'/);
assert.match(src,/goldModuleChannel.onmessage=event/);
assert.match(src,/void goldModulesRefresh\(\)/);
// Authenticated owner identity change partitions cached state.
owner='other@example.invalid';
persisted={revision:0,longMemory:false,codexBridge:false};
await tabA.refresh();
assert.equal(tabA.value().ownerIdentity,owner);
assert.equal(tabA.value().revision,0);
assert.equal(tabA.value().longMemory,false);
// Failure to verify outcome leaves controller UNKNOWN and prohibits another blind mutation.
let retry=0;
const unknown=make(async()=>{throw Error('server_unavailable')},
 async()=>{retry++;throw Error('network_outcome_unknown')});
assert.equal(await unknown.refresh(),false);
assert.equal(await unknown.set('longMemory',true),false);
assert.equal(retry,0);
assert.equal(unknown.value(),null);
// UI uses direct actions with no Save/checkbox, and disabling never calls delete.
assert.match(src,/goldMemoryDisableButton/);
assert.match(src,/goldSetModule\('longMemory',false\)/);
assert.match(src,/goldMemoryEnableButton/);
assert.doesNotMatch(src,/id=\\"goldModulesSave\\"|id=\\"goldLongMemory\\"/);
assert.match(src,/gold_module_outcome_unknown_refresh_required/);
console.log('T11_MODULE_FLAGS_REVERSED_REVISION_MULTI_TAB_409_CAS_PENDING_UNKNOWN_OWNER=PASS');
