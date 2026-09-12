import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';

const root=path.resolve(new URL('../..',import.meta.url).pathname),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-account-api-'));
const socket=path.join(tmp,'operator.sock'),state=path.join(tmp,'state'),log=path.join(tmp,'log');fs.mkdirSync(state);fs.mkdirSync(log);
const child=spawn(process.execPath,[path.join(root,'operator-host/executor.mjs')],{env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:state,OPERATOR_LOG_DIR:log,OPERATOR_DEVICE_ID:'arm-test',OPERATOR_NODE_ID:'arm-test-node',OPERATOR_DEVICE_NAME:'ACCOUNT-TEST',OPERATOR_ACCOUNT_ID:'self-hosted-local'},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
function request(method,target,body=null,token=''){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body));const headers={accept:'application/json'};if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}if(token)headers['x-light-account-session']=token;const req=http.request({socketPath:socket,method,path:target,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);if(payload)req.write(payload);req.end();});}
async function waitSocket(){for(let i=0;i<80;i++){if(fs.existsSync(socket))return;await new Promise(r=>setTimeout(r,50));}throw new Error('test_operator_socket_timeout:'+childLog);}
const email=`integration-${crypto.randomBytes(4).toString('hex')}@example.test`;
const secret=`T-${crypto.randomBytes(18).toString('base64url')}`;
try{
  await waitSocket();
  const denied=await request('POST','/v1/accounts/register',{email,password:secret});
  if(denied.status!==403||denied.json.error!=='owner_migration_proof_required')throw new Error('owner_proof_boundary_failed');
  const reg=await request('POST','/v1/accounts/register',{email,password:secret,ownerProofVerified:true});
  if(reg.status!==201||reg.json.account?.accountId!=='self-hosted-local'||!reg.json.token)throw new Error('register_failed');
  const token=reg.json.token;
  const me=await request('GET','/v1/accounts/me',null,token);
  if(me.status!==200||me.json.account?.accountId!=='self-hosted-local')throw new Error('me_failed');
  const dev=await request('GET','/v1/accounts/devices',null,token);
  if(dev.status!==200||dev.json.devices?.length!==1||dev.json.devices[0]?.deviceId!=='arm-test'||dev.json.devices[0]?.accountId!=='self-hosted-local')throw new Error('account_devices_failed');
  const dup=await request('POST','/v1/accounts/register',{email,password:secret,ownerProofVerified:true});
  if(dup.status!==409||dup.json.error!=='account_email_exists')throw new Error('duplicate_register_failed');
  const bad=await request('POST','/v1/accounts/login',{email,password:'definitely-wrong'});
  if(bad.status!==401||bad.json.error!=='invalid_account_credentials')throw new Error('bad_login_failed');
  const login=await request('POST','/v1/accounts/login',{email,password:secret});
  if(login.status!==200||login.json.account?.accountId!=='self-hosted-local'||!login.json.token)throw new Error('login_failed');
  const logout=await request('POST','/v1/accounts/logout',{},login.json.token);
  if(logout.status!==200||logout.json.loggedOut!==true)throw new Error('logout_failed');
  const after=await request('GET','/v1/accounts/me',null,login.json.token);
  if(after.status!==401||after.json.error!=='account_session_required')throw new Error('logout_session_still_valid');
  const stateText=fs.readFileSync(path.join(state,'accounts.json'),'utf8');
  if(stateText.includes(secret)||stateText.includes(token)||stateText.includes(login.json.token))throw new Error('raw_secret_persisted');
  const audit=fs.readFileSync(path.join(log,'operations.jsonl'),'utf8');
  if(audit.includes(email))throw new Error('email_leaked_to_audit');
  console.log(JSON.stringify({ok:true,register:true,login:true,me:true,devices:true,logout:true,rawSecretsPersisted:false,emailAuditLeak:false},null,2));
  console.log('ACCOUNT_API_GATE=PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise(r=>setTimeout(r,100));
  fs.rmSync(tmp,{recursive:true,force:true});
}
