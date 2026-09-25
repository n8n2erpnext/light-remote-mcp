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

function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
const plus=createPlusAuth(wall,{listClientDevices:async()=>({devices:[]})});
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

fs.rmSync(dir,{recursive:true,force:true});
console.log('v11-client-diagnostic-reasons=PASS');
console.log('v11-client-diagnostic-redaction=PASS');
