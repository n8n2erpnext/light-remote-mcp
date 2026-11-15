import assert from 'node:assert/strict';
import {runGoldMemoryViaAuthorizedSession} from '../../plugin-server/gold-memory-bridge.mjs';
const input={sessionId:'session-exact',operationId:'memory-op-test-001',action:'save',title:'Checkpoint',body:'PRIVATE_MEMORY_SENTINEL_PLUGIN',source:'owner-explicit',clientRoot:'/ignored-legacy-alias'};
let called=0;
const result=await runGoldMemoryViaAuthorizedSession({
 exec(){throw Error('shell must never be used');},output(){throw Error('stdout must never be used');},
 memory:async(session,request,id)=>{called++;assert.equal(session,input.sessionId);assert.equal(id,input.operationId);assert.equal(request.body,input.body);assert.equal(request.clientRoot,undefined);return {ok:true,result:{id:'saved'}};}
},input);
assert.equal(result.result.id,'saved');assert.equal(called,1);
const pending=await runGoldMemoryViaAuthorizedSession({memory:async()=>({ok:false,pending:true,requestRef:'mem_'+'a'.repeat(48)})},input);
assert.equal(pending.operationId,input.operationId);assert.match(pending.nextAction,/poll.*do_not_repeat/);
await assert.rejects(runGoldMemoryViaAuthorizedSession({exec:async()=>{throw Error('must not run');}},input),/upgrade_required/);
await assert.rejects(runGoldMemoryViaAuthorizedSession({memory:async()=>{throw Error('device_access_grant_required');}},input),/device_access_grant_required/);
await assert.rejects(runGoldMemoryViaAuthorizedSession({memory:async()=>assert.fail('invalid request executed')},{...input,action:'exec'}),/request_invalid/);
console.log('GOLD_MEMORY_TYPED_EXACT_SESSION_NO_SHELL_STDOUT_OR_FALLBACK_PASS');
