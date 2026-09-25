import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createWallAuth,hashWallPassword} from '../../gateway/wall-auth.mjs';
import {createPlusAuth} from '../../gateway/plus-auth.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lrm-client-diag-'));
const configFile=path.join(dir,'wall-auth.json');
fs.writeFileSync(configFile,JSON.stringify({
  mode:'local',
  username:'diag',
  passwordHash:hashWallPassword('diag-password'),
  cookieSecret:crypto.randomBytes(32).toString('base64url'),
  sessionTtlSeconds:3600
}));
const wall=createWallAuth({configFile,cookieSecure:false});
const now=Date.now();
const payload={scope:'agent-client',clientSessionId:'lrc_diag_0001',agentId:'agent-client-diag-0001',iat:now-1000,exp:now+60000,jti:'diag-jti'};
const valid=wall.signOAuthToken('client',payload);
assert.equal(wall.inspectOAuthToken('client',valid).reason,'valid');
assert.equal(wall.verifyOAuthToken('client',valid)?.clientSessionId,payload.clientSessionId);

const parts=valid.split('.');
parts[3]=(parts[3][0]==='A'?'B':'A')+parts[3].slice(1);
assert.equal(wall.inspectOAuthToken('client',parts.join('.')).reason,'signature');
assert.equal(wall.verifyOAuthToken('client',parts.join('.')),null);

const expired=wall.signOAuthToken('client',{...payload,exp:now-1});
assert.equal(wall.inspectOAuthToken('client',expired).reason,'expired');
const wrongExp=wall.signOAuthToken('client',{...payload,exp:String(now+60000)});
assert.equal(wall.inspectOAuthToken('client',wrongExp).reason,'exp_type');

const clientRef=wall.mintClientRef({clientSessionId:payload.clientSessionId,agentId:payload.agentId});
assert.match(clientRef,/^lr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
assert.ok(clientRef.length<valid.length);
assert.equal(wall.inspectClientRef(clientRef).reason,'valid');
assert.equal(wall.verifyClientRef(clientRef)?.clientSessionId,payload.clientSessionId);
assert.equal(wall.verifyClientRef(clientRef)?.agentId,payload.agentId);
const refParts=clientRef.split('.');
refParts[3]=(refParts[3][0]==='A'?'B':'A')+refParts[3].slice(1);
assert.equal(wall.inspectClientRef(refParts.join('.')).reason,'signature');
assert.equal(wall.verifyClientRef(refParts.join('.')),null);

function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
const plus=createPlusAuth(wall,{listClientDevices:async()=>({devices:[]})});
const refReq={headers:{'x-light-client':clientRef},body:{},query:{},get(name){return this.headers[String(name).toLowerCase()]||'';}};
const refRes=response();let refPassed=false;
await plus.requireClient(refReq,refRes,()=>{refPassed=true;});
assert.equal(refPassed,true);
assert.equal(refReq.plusClient?.clientSessionId,payload.clientSessionId);
assert.equal(refReq.plusClient?.agentId,payload.agentId);

const req={headers:{'x-light-client':expired,'x-light-trace':'trace-diag-001'},body:{},query:{},get(name){return this.headers[String(name).toLowerCase()]||'';}};
const res=response(),warn=console.warn,rows=[];
console.warn=value=>rows.push(String(value));
try{await plus.requireClient(req,res,()=>assert.fail('expired client must not pass'));}finally{console.warn=warn;}
assert.equal(res.statusCode,401);
assert.equal(res.body?.error,'agent_client_required');
assert.equal(rows.length,1);
const logged=JSON.parse(rows[0]);
assert.equal(logged.event,'agent_client_rejected');
assert.equal(logged.traceId,'trace-diag-001');
assert.equal(logged.reason,'expired');
assert.match(logged.clientFingerprint,/^[a-f0-9]{16}$/);
assert.equal(logged.clientLength,expired.length);
assert.equal(rows[0].includes(expired),false);

const grant={grantId:'dag_diag_client_ref_0001',deviceId:'dev-diag',connectionId:'dc-diag',expiresAt:now+60000};
const recoveryPlus=createPlusAuth(wall,{
  pollAccess:async()=>({access:{state:'approved',grant}}),
  getAccessRequest:async id=>({authorization:{requestId:id,agentId:payload.agentId}}),
  attachClient:async body=>({client:{clientSessionId:payload.clientSessionId,agentId:body.agentId,expiresAt:now+60000},device:{deviceId:grant.deviceId,displayName:'DIAG'}}),
  ensureClientContext:async body=>({ok:true,context:{clientSessionId:body.clientSessionId,agentId:body.agentId,deviceId:body.deviceId,sessionId:'session-diag-ref',nodeId:'arm',workspace:'',gracePreset:'60m'}})
});
const recoverRes=response();
await recoveryPlus.connectRecover({body:{requestId:'pa_diag_client_ref_00000001',pollToken:'R'.repeat(32)}},recoverRes);
assert.equal(recoverRes.statusCode,200);
assert.equal(recoverRes.body?.status,'ready');
assert.match(String(recoverRes.body?.client||''),/^lr1\./);
assert.ok(String(recoverRes.body.client).length<valid.length);

fs.rmSync(dir,{recursive:true,force:true});
console.log('v11-client-diagnostic-reasons=PASS');
console.log('v11-client-diagnostic-redaction=PASS');
console.log('v11-client-ref-mint-verify=PASS');
console.log('v11-client-ref-ready-recovery=PASS');
