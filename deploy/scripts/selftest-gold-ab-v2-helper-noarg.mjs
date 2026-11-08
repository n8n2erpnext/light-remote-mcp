import assert from 'node:assert/strict';
import {registerPluginTools} from '../../plugin-server/tools.mjs';
import {AccountOperatorAdapter} from '../../plugin-server/operator-adapter.mjs';
const registered=new Map();
registerPluginTools({registerTool:(name,_config,callback)=>registered.set(name,callback)},
 {accountId:'owner-fixture',clientId:'oauth-fixture',scopes:['remote:read']});
const helper=registered.get('light_remote_connection_helper');
assert.equal(typeof helper,'function');
const proto=AccountOperatorAdapter.prototype;
const originals=Object.fromEntries(['recoverAbV2Request','pairRecover','connectionHelper']
 .map(k=>[k,proto[k]]));
let v2,legacyCalls=0,workingCalls=0;
try{
 proto.recoverAbV2Request=async()=>v2;
 proto.pairRecover=async()=>{legacyCalls++;return {state:'pending',request:{userCode:'AAAA-BBBB',
  expiresAt:Date.now()+120000}}};
 proto.connectionHelper=async()=>{workingCalls++;return {status:'ready',
  account:{plan:'free'},context:{sessionId:'test-session'}}};
 v2={status:'approval_required',protocol:'abv2',code:'ABCD-2345',
  helperReady:false,approvalPath:'/approve'};
 let x=(await helper({})).structuredContent;
 assert.equal(x.status,'approval_required');assert.equal(x.code,'ABCD-2345');
 assert.equal(legacyCalls,0,'V2 pending cannot fall back to V1 recovery');
 assert.equal(workingCalls,0,'no working session before durable grant');
 v2={status:'ambiguous_pending_requests',helperReady:false,
  nextAction:'poll_exact_request_explicitly'};
 x=(await helper({})).structuredContent;
 assert.equal(x.status,'ambiguous_pending_requests');
 assert.equal(legacyCalls,0,'ambiguous V2 cannot choose newest or V1');
 v2={status:'ready',helperReady:true,pairedDevice:'dev1'};
 x=(await helper({})).structuredContent;
 assert.equal(x.status,'ready');assert.equal(x.protocol,'abv2');
 assert.equal(x.pairedDevice,'dev1');assert.equal(workingCalls,1);
 assert.equal(legacyCalls,0);
 v2=null;
 x=(await helper({})).structuredContent;
 assert.equal(x.status,'approval_required');assert.equal(x.code,'AAAA-BBBB');
 assert.equal(legacyCalls,1,'legacy V1 still recovers when no V2 request');
 console.log('GOLD_ABV2_MCP_NOARG_RECOVER_PENDING_AMBIGUOUS_READY_V1_FALLBACK=PASS');
}finally{
 for(const [name,fn] of Object.entries(originals))proto[name]=fn;
}
