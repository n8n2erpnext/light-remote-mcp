import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-account-routing-'));
const socketPath=ipcEndpoint('lr-account-routing'),stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');
fs.mkdirSync(logDir,{recursive:true});removeIpcEndpoint(socketPath);
const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socketPath,OPERATOR_STATE_DIR:stateDir,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_ACCOUNT_ID:'acct-bootstrap',OPERATOR_DEVICE_ID:'device-bootstrap',OPERATOR_NODE_ID:'node-bootstrap'},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function request(method,target,body){return new Promise((resolve,reject)=>{const raw=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath,method,path:target,headers:raw?{'content-type':'application/json','content-length':raw.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);if(raw)req.write(raw);req.end();});}
try{
 await waitForIpc(socketPath,{attempts:80,delayMs:50,error:'socket_not_ready',details:()=>logs});
 const aid='agent-routing-isolation-aaaa';
 const d=await request('POST','/v1/sessions/open',{agentId:aid,openId:'open-routing-default-aaaa'});
 if(d.status!==200||d.json.session.accountId!=='acct-bootstrap')throw new Error('default_route_regressed');
 const explicit=await request('POST','/v1/sessions/open',{accountId:'acct-bootstrap',agentId:'agent-routing-explicit-aaaa',openId:'open-routing-explicit-aa'});
 if(explicit.status!==200||explicit.json.session.accountId!=='acct-bootstrap')throw new Error('explicit_bootstrap_failed');
 const denied=await request('POST','/v1/sessions/open',{accountId:'acct-other',nodeId:'node-bootstrap',agentId:'agent-routing-denied-aaaa',openId:'open-routing-denied-aaaa'});
 if(denied.status!==403||denied.json.error!=='target_node_account_mismatch')throw new Error('cross_account_local_route_not_denied:'+JSON.stringify(denied));
 console.log(JSON.stringify({ok:true,defaultAccount:d.json.session.accountId,crossAccountStatus:denied.status},null,2));
}finally{child.kill('SIGTERM');removeIpcEndpoint(socketPath);fs.rmSync(dir,{recursive:true,force:true});}
