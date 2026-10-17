import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const project=path.resolve(import.meta.dirname,'../..');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-gold-operator-'));
fs.chmodSync(root,0o700);
const inside=relative=>path.join(root,relative);
fs.mkdirSync(inside('runtime'),{recursive:true,mode:0o700});
const socket=inside('runtime/operator.sock');
const env={
  PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,TMPDIR:root,NODE_ENV:'test',
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1', LIGHT_REMOTE_GOLD_ROOT:root,
  OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:inside('state'),
  OPERATOR_LOG_DIR:inside('logs'),OPERATOR_KEY_FILE:inside('secrets/operator.private.json'),
  OPERATOR_ACCOUNT_ID:'isolated-gold-owner',OPERATOR_DEVICE_ID:'isolated-gold-device',
  OPERATOR_NODE_ID:'isolated-gold-node',OPERATOR_INTEGRATED_HOST:'0',
  OPERATOR_ACCOUNT_PLAN:'free',OPERATOR_CONNECTION_LEASE_ENFORCE:'1'
};
const proc=spawn(process.execPath,[path.join(project,'operator-host/executor.mjs')],{
 cwd:project,env,stdio:['ignore','pipe','pipe']
});
let output='';
proc.stdout.on('data',d=>output+=(d.toString()).slice(0,1200));
proc.stderr.on('data',d=>output+=(d.toString()).slice(0,1200));
const query=p=>new Promise((resolve,reject)=>{
 const req=http.request({socketPath:socket,path:p,method:'GET'},res=>{
  const chunks=[];res.on('data',b=>chunks.push(b));
  res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))})}catch(e){reject(e)}});
 });
 req.on('error',reject);req.end();
});
try{
 let ready=false;
 for(let n=0;n<95;n++){
  if(proc.exitCode!==null)break;
  try{const h=await query('/healthz');if(h.status===200&&h.body.ok){ready=true;break}}catch{}
  await new Promise(r=>setTimeout(r,80));
 }
 assert(ready,'gold_operator_not_ready: '+output.slice(-1400));
 const notifications=await query('/v1/admin/notifications');
 assert.equal(notifications.status,200);
 assert.equal(notifications.body.ok,true);
 assert.deepEqual(notifications.body.notifications,[]);
 const accounts=await query('/v1/admin/accounts');
 assert.equal(accounts.status,200);
 assert.equal(accounts.body.ok,true);
 assert(Array.isArray(accounts.body.accounts));
 const unknown=await query('/v1/definitely-not-a-route');
 assert.equal(unknown.status,404);
 console.log('GOLD_ISOLATED_OPERATOR_SOCKET_HEALTH_ADMIN_ACCOUNTS_NOTIFICATIONS_PASS');
 console.log('GOLD_ISOLATED_OPERATOR_NO_PRODUCTION_DATA_OR_UNIX_SOCKET_PASS');
}finally{
 proc.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>proc.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1000))]);
 if(proc.exitCode===null)proc.kill('SIGKILL');
 fs.rmSync(root,{recursive:true,force:true});
}
