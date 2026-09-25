import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createPlusAuth} from '../../gateway/plus-auth.mjs';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';

const key=crypto.randomBytes(32);
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sign=(kind,payload)=>{const body=enc(payload),mac=crypto.createHmac('sha256',key).update('scoped:'+kind+':'+body).digest('base64url');return 'o1.'+kind+'.'+body+'.'+mac;};
const verify=(kind,token)=>{const p=String(token||'').split('.');if(p.length!==4||p[0]!=='o1'||p[1]!==kind)return null;const mac=crypto.createHmac('sha256',key).update('scoped:'+kind+':'+p[2]).digest('base64url');if(mac!==p[3])return null;const v=JSON.parse(Buffer.from(p[2],'base64url').toString());return !v.exp||v.exp>Date.now()?v:null;};
const wall={signOAuthToken:sign,verifyOAuthToken:verify};
function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}

const plus=createPlusAuth(wall,{listClientDevices:async()=>({devices:[]})});
const tok=sign('client',{scope:'agent-client',clientSessionId:'cookie-client-0001',agentId:'agent-cookie-test-0001',exp:Date.now()+60000});
const req={headers:{cookie:'light_remote_client='+encodeURIComponent(tok)},body:{},query:{},get:()=>''};
const res=response(); let called=false;
await plus.requireClient(req,res,async()=>{called=true;});
assert.equal(called,true);
assert.equal(req.plusClientTransport,'cookie');
assert.equal(req.plusClient.clientSessionId,'cookie-client-0001');

let now=5_000_000;
const file='/tmp/lrm-client-resilience-'+process.pid+'.json';
fs.rmSync(file,{force:true});
const reg=new AgentClientRegistry({stateFile:file,now:()=>now,ttlMs:60*60*1000});
const grant={grantId:'dag_resilience_0001',deviceId:'dev-a',connectionId:'dc-a'};
const first=reg.attach({accountId:'acct',agentId:'agent-client-test-0001',grant});
reg.rows.delete(first.clientSessionId);
const recovered=reg.view(first.clientSessionId,{agentId:'agent-client-test-0001'});
assert.equal(recovered.clientSessionId,first.clientSessionId);
fs.rmSync(file,{force:true});

console.log('v09-client-cookie-fallback=PASS');
console.log('v09-client-registry-reload=PASS');
