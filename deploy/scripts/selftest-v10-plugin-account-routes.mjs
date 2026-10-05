import { fileURLToPath } from 'node:url';
import fs from 'node:fs';import http from 'node:http';import os from 'node:os';import path from 'node:path';import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url)),dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-plugin-account-')),socket=ipcEndpoint('lr-plugin-account'),stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');fs.mkdirSync(logDir,{recursive:true});removeIpcEndpoint(socket);const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[path.join(root,'operator-host','executor.mjs')],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:stateDir,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:fixture.privateFile},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
function request(method,target,body){return new Promise((resolve,reject)=>{const raw=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath:socket,method,path:target,headers:raw?{'content-type':'application/json','content-length':raw.length}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);if(raw)req.write(raw);req.end();});}
try{await waitForIpc(socket,{attempts:100,delayMs:40,error:'executor_not_ready',details:()=>logs});
 let r=await request('POST','/v1/accounts/register',{ownerProofVerified:true,email:'owner@example.test',password:'Owner route password 12345'});if(r.status!==201||r.json.account?.accountId!=='self-hosted-local')throw new Error('bootstrap_route_regressed:'+JSON.stringify(r));
 const stateFile=path.join(stateDir,'accounts.json'),sessionsBefore=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;
 r=await request('POST','/v1/accounts/password-verify',{email:'owner@example.test',password:'Owner route password 12345'});if(r.status!==200||r.json.account?.accountId!=='self-hosted-local'||r.json.token||r.json.session)throw new Error('wall_password_verify_failed:'+JSON.stringify(r));
 const afterWallVerify=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;if(afterWallVerify!==sessionsBefore)throw new Error('wall_password_verify_created_session');
 r=await request('POST','/v1/accounts/password-verify',{email:'owner@example.test',password:'wrong wall credential'});if(r.status!==401||r.json.error!=='invalid_account_credentials')throw new Error('wall_password_verify_wrong_not_rejected');
 r=await request('POST','/v1/plugin/accounts/register',{email:'hosted@example.test',password:'Hosted route password 12345'});if(r.status!==201||!r.json.pending?.pendingId||!r.json.token)throw new Error('plugin_pending_register_failed:'+JSON.stringify(r));const pendingId=r.json.pending.pendingId,verificationToken=r.json.token;
 const afterRegister=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;if(afterRegister!==sessionsBefore)throw new Error('pending_register_created_session');
 r=await request('POST','/v1/plugin/accounts/registration/verify',{pendingId,token:verificationToken,issueSession:false});if(r.status!==200||!String(r.json.account?.accountId||'').startsWith('acct_')||r.json.account?.plan!=='free'||r.json.token)throw new Error('plugin_verify_registration_failed:'+JSON.stringify(r));const accountId=r.json.account.accountId;
 r=await request('POST','/v1/plugin/auth/verify',{email:'hosted@example.test',password:'Hosted route password 12345'});if(r.status!==200||r.json.account?.accountId!==accountId)throw new Error('plugin_verify_failed:'+JSON.stringify(r));
 const afterVerify=JSON.parse(fs.readFileSync(stateFile,'utf8')).sessions.length;if(afterVerify!==sessionsBefore)throw new Error('plugin_verify_created_session');
 r=await request('POST','/v1/plugin/auth/verify',{email:'hosted@example.test',password:'wrong password'});if(r.status!==401||r.json.error!=='invalid_account_credentials')throw new Error('plugin_verify_wrong_password_not_rejected');
 console.log(JSON.stringify({ok:true,bootstrapPreserved:true,hostedAccountId:accountId,verifyNoPortalSession:true},null,2));
}finally{
 if(child.exitCode==null){try{child.kill('SIGTERM')}catch{};await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1000))]);}
 if(child.exitCode==null){try{child.kill('SIGKILL')}catch{}}
 removeIpcEndpoint(socket);
 for(let i=0;i<20;i++){try{fs.rmSync(dir,{recursive:true,force:true});break}catch(error){if(i===19)throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
}
