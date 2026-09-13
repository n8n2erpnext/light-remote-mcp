import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

const root=path.resolve(new URL('../..',import.meta.url).pathname),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-license-admin-'));
const socket=path.join(tmp,'operator.sock'),state=path.join(tmp,'state'),log=path.join(tmp,'log');fs.mkdirSync(state);fs.mkdirSync(log);
const child=spawn(process.execPath,[path.join(root,'operator-host/executor.mjs')],{env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:state,OPERATOR_LOG_DIR:log,OPERATOR_DEVICE_ID:'arm-admin-test',OPERATOR_NODE_ID:'arm-admin-test-node',OPERATOR_DEVICE_NAME:'ADMIN-TEST',OPERATOR_ACCOUNT_ID:'self-hosted-local',OPERATOR_CONNECTION_LEASE_ENFORCE:'1'},stdio:['ignore','pipe','pipe']});
let childLog='';child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
function request(method,target,body=null,token=''){return new Promise((resolve,reject)=>{const payload=body==null?null:Buffer.from(JSON.stringify(body)),headers={accept:'application/json'};if(payload){headers['content-type']='application/json';headers['content-length']=payload.length;}if(token)headers['x-light-account-session']=token;const req=http.request({socketPath:socket,method,path:target,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>{let json;try{json=JSON.parse(text)}catch{json={raw:text}}resolve({status:res.statusCode,json});});});req.on('error',reject);if(payload)req.write(payload);req.end();});}
async function waitSocket(){for(let i=0;i<100;i++){if(fs.existsSync(socket))return;await new Promise(r=>setTimeout(r,40));}throw new Error('operator_socket_timeout:'+childLog);}
function cli(...args){const r=spawnSync(process.execPath,[path.join(root,'deploy/scripts/light-remote-license-admin.mjs'),...args],{cwd:root,encoding:'utf8',env:{...process.env,OPERATOR_SOCKET:socket}});if(r.status!==0)throw new Error(`cli_failed:${args[0]}:${r.stderr}`);return JSON.parse(r.stdout);}
const email=`license-admin-${crypto.randomBytes(4).toString('hex')}@example.test`,password=`T-${crypto.randomBytes(18).toString('base64url')}`;
try{
  await waitSocket();
  const reg=await request('POST','/v1/accounts/register',{email,password,ownerProofVerified:true});if(reg.status!==201||!reg.json.token)throw new Error('register_failed');const token=reg.json.token;
  const issued=cli('issue','pro','30','selftest');if(!issued.key||issued.license?.plan!=='pro')throw new Error('cli_issue_failed');const plaintextKey=issued.key;
  const stateText=fs.readFileSync(path.join(state,'license-keys.json'),'utf8');if(stateText.includes(plaintextKey)||stateText.replace(/-/g,'').includes(plaintextKey.replace(/-/g,'')))throw new Error('plaintext_license_persisted');
  const redeemed=await request('POST','/v1/accounts/redeem-license',{key:plaintextKey},token);if(redeemed.status!==200||redeemed.json.account?.plan!=='pro')throw new Error('live_redeem_failed');
  const granted=cli('grant','self-hosted-local','vip','permanent');if(granted.account?.plan!=='vip'||granted.account?.entitlement?.source!=='admin')throw new Error('cli_grant_failed');
  let conn=await request('POST','/v1/devices/arm-admin-test/connection/connect',{requestedLeaseMs:2*60*60*1000});if(conn.status!==200||conn.json.connection?.plan!=='vip')throw new Error('vip_connection_failed');
  const revoked=cli('revoke-entitlement','self-hosted-local','selftest-revoke');if(revoked.account?.plan!=='free'||!revoked.closedDevices?.includes('arm-admin-test'))throw new Error('cli_entitlement_revoke_failed');
  conn=await request('GET','/v1/devices/arm-admin-test/connection');if(conn.status!==200||conn.json.connection?.state!=='dormant')throw new Error('entitlement_revoke_did_not_close_lease');
  const account=cli('account','self-hosted-local');if(account.account?.plan!=='free')throw new Error('cli_account_not_live');
  console.log('v09-license-admin-live-authority=PASS');
  console.log('v09-license-admin-key-hash-only=PASS');
  console.log('v09-license-admin-revoke-closes-lease=PASS');
} finally {child.kill('SIGTERM');await new Promise(r=>setTimeout(r,120));fs.rmSync(tmp,{recursive:true,force:true});}
