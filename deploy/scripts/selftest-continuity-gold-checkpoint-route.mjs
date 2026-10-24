import assert from 'node:assert/strict';
import {handlePluginRoutes} from '../../operator-host/executor-routes-plugin.mjs';
let captured=null,signCount=0,duplexCount=0;
const accountId='gold-owner-account',sessionId='s_gold_active_0100',deviceId='gold-client-device';
const note={accountId,agentId:'gpt-gold-agent',sessionId,operationId:'1c93df43-18a9-4ec6-9ae1-409fa44b4cb1',projectId:'00000000-0000-4000-8000-000000000001',
 body:'Milestone reached. Next: verify outstanding integration.',kind:'observation',sourceRef:'commit:source-verified'};
const deps={
 accounts:{account:id=>({accountId:id})},
 sessions:{get:(id,agent)=>({sessionId:id,agentId:agent,accountId,deviceId,state:'active'})},
 AccountError:class extends Error{constructor(msg,status){super(msg);this.status=status;}},
 requireDeviceConnection:id=>assert.equal(id,deviceId),
 readJson:async()=>note,
 signScopedContinuityWrite:args=>{signCount++;assert.equal(args.body,note.body);
  assert.equal(args.deviceId,deviceId);assert.ok(args.requestId.length===36);
  return {grant:{purpose:'test-only-signed-proof'},signature:'fixture-only'};},
 confidentialProjectWrite:async args=>{duplexCount++;captured=args;return {saved:true,id:'11111111-1111-4111-8111-111111111111',duplicate:false};},
 sendJson:(res,code,value)=>{res.status=code;res.reply=value;return true;}
};
const response=()=>({
 headers:null,text:null,status:0,
 writeHead(code,headers){this.status=code;this.headers=headers;},
 end(value){this.text=value;}
});
const target=new URL('http://localhost/v1/plugin/project-continuity/write');
const original=process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
try{
 delete process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
 let res=response();
 await handlePluginRoutes({method:'POST'},res,target,deps);
 assert.equal(res.status,404);assert.equal(signCount,0);assert.equal(duplexCount,0);
 process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL='1';
 res=response();
 await handlePluginRoutes({method:'POST'},res,target,deps);
 assert.equal(res.status,200);
 assert.equal(res.headers['cache-control'],'no-store, private');
 assert.equal(signCount,1);assert.equal(duplexCount,1);
 assert.equal(captured.projectId,note.projectId);
 assert.equal(captured.requestId,note.operationId);
 assert.equal(captured.sessionId,sessionId);
 assert.equal(captured.body,note.body);
 assert.equal(captured.kind,note.kind);
 assert.equal(captured.sourceRef,note.sourceRef);
 assert.equal(captured.proof.grant.purpose,'test-only-signed-proof');
 assert.equal(JSON.parse(res.text).data.saved,true);
 assert.ok(!res.text.includes(note.body),'Gold Operator must only return receipt, not note body');
 const invalid={...deps,sessions:{get:()=>({sessionId,agentId:note.agentId,accountId,deviceId,state:'hold'})}};
 res=response();
 await handlePluginRoutes({method:'POST'},res,target,invalid);
 assert.equal(res.status,409);assert.equal(duplexCount,1);
 const wrong={...deps,sessions:{get:()=>({sessionId,agentId:note.agentId,accountId:'other-account',deviceId,state:'active'})}};
 await assert.rejects(handlePluginRoutes({method:'POST'},response(),target,wrong),/plugin_session_account_mismatch/);
 console.log('GOLD_PLUGIN_SIGNED_CHECKPOINT_ROUTE_ACTIVE_AB_AND_NO_CLOUD_RECEIPT_BODY_PASS');
 console.log('GOLD_PLUGIN_OFF_OFF_AND_UNAUTHORIZED_SESSION_DENIAL_PASS');
}finally{
 if(original===undefined)delete process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
 else process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=original;
}
