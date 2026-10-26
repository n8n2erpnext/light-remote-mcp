#!/usr/bin/env node
// Gold UAT owner-operated orphan recovery. NEVER run unattended.
// The normal authenticated Operator route owns recovery. When a historical
// owner-removed device is hidden from its active registry (404 ONLY), this
// owner-authenticated emergency path invokes the SAME audited library method
// with a local PostgreSQL peer identity after dropping root privileges.
// No raw SQL mutation, forged terminal ACK, service restart or UAT cutover.
import pg from 'pg';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout,stderr} from 'node:process';

const SOCKET='/run/light-remote-gold-uat/operator.sock';
function assert(ok,message){if(!ok)throw Error(message);}
function readClaim(){
 const sql=`SELECT json_build_object(
   'jobId',c.job_id,'deviceId',c.device_id,'accountId',c.account_id,
   'nodeId',d.node_id,'claimedAt',c.claimed_at,
   'workerState',c.worker_state,'launchStatus',j.status,
   'deviceLabel',d.display_name,'deviceState',d.state,'policyProfile',d.policy_profile,
   'liveConnection',EXISTS(SELECT 1 FROM lr_device_connections co
     WHERE co.device_id=c.device_id AND co.account_id=c.account_id
       AND co.closed_at IS NULL AND co.hard_expires_at>NOW()),
   'ackPresent',EXISTS(SELECT 1 FROM lr_gold_terminal_receipt_acks a
     WHERE a.account_id=c.account_id AND a.device_id=c.device_id AND a.process_id=c.process_id)
 ) FROM lr_gold_device_resource_claims c
 JOIN lr_gold_job_records j ON j.job_id=c.job_id AND j.account_id=c.account_id AND j.device_id=c.device_id
 JOIN lr_devices d ON d.device_id=c.device_id`;
 const raw=execFileSync('runuser',['-u','postgres','--','psql','-d','light_remote_gold_dev','-AtX','-v','ON_ERROR_STOP=1','-c',sql],{encoding:'utf8',timeout:8000,maxBuffer:32768}).trim();
 const lines=raw.split('\n').filter(Boolean);
 assert(lines.length===1,'Expected exactly one claim; refuse ambiguous selection.');
 const claim=JSON.parse(lines[0]);
 assert(claim.workerState==='running'&&claim.launchStatus==='ok'&&!claim.ackPresent,
  'Claim changed, no longer eligible, or has a terminal ACK.');
 return claim;
}
function request(path,body,token){
 return new Promise((resolve,reject)=>{
  const payload=JSON.stringify(body);
  const req=http.request({socketPath:SOCKET,path,method:'POST',timeout:8000,headers:{
   'content-type':'application/json','content-length':Buffer.byteLength(payload),
   ...(token?{'x-light-account-session':token}:{})
  }},res=>{
   let result='';
   res.on('data',v=>{result+=v; if(result.length>65536)req.destroy(Error('oversized_response'));});
   res.on('end',()=>{
    let data={};try{data=JSON.parse(result);}catch{}
    if(res.statusCode>=400)return reject(Error('Operator denied ('+res.statusCode+'): '+String(data.error||data.code||'unknown_error').slice(0,100)));
    resolve(data);
   });
  });
  req.on('timeout',()=>req.destroy(Error('operator_timeout')));
  req.on('error',reject);
  req.end(payload);
 });
}
async function assertHistoricalChannelOffline(claim){
 assert(claim.deviceState==='revoked'&&claim.policyProfile==='__gold_removed_v1__',
   'Historical owner-removed device proof missing; refuse fallback.');
 assert(!claim.liveConnection,'Original device still has an unexpired connected session.');
 return new Promise((resolve,reject)=>{
  const req=http.get({socketPath:SOCKET,path:'/v1/fleet',timeout:8000},res=>{
   let body='';res.on('data',part=>{body+=part;if(body.length>65536)req.destroy(Error('oversized_fleet'));});
   res.on('end',()=>{
    try{
     assert(res.statusCode===200,'Fleet state unavailable.');
     const fleet=JSON.parse(body);assert(fleet.ok===true&&fleet.requireExecutorReady===true,'Strict Gold Fleet admission unavailable.');
     const nodes=Array.isArray(fleet.nodes)?fleet.nodes:[];
     const found=nodes.filter(n=>n.deviceId===claim.deviceId||n.nodeId===claim.nodeId);
     assert(!found.some(n=>n.channelFresh===true||n.state==='connected'||n.connectionState==='connected'),
       'Historical Gold node is connected/fresh. Refuse orphan abandonment.');
     resolve(true);
    }catch(e){reject(e);}
   });
  });
  req.on('timeout',()=>req.destroy(Error('fleet_timeout')));
  req.on('error',reject);
 });
}
async function secret(prompt){
 assert(stdin.isTTY&&typeof stdin.setRawMode==='function','Owner must enter password in an interactive terminal.');
 stdout.write(prompt);
 return new Promise((resolve,reject)=>{
  let bytes=[];const wasRaw=stdin.isRaw;
  function done(error){
   stdin.off('data',onData);stdin.setRawMode(Boolean(wasRaw));stdin.pause();stdout.write('\n');
   if(error)reject(error);else resolve(Buffer.from(bytes).toString('utf8'));
  }
  function onData(chunk){
   for(const n of chunk){
    if(n===3)return done(Error('Cancelled'));
    if(n===13||n===10)return done();
    if(n===127||n===8){bytes.pop();continue;}
    if(bytes.length>=2048)return done(Error('Password input too long'));
    bytes.push(n);
   }
  }
  stdin.setRawMode(true);stdin.resume();stdin.on('data',onData);
 });
}
async function main(){
 assert(process.getuid?.()===0,'Run this tool as root INSIDE the Gold UAT LXD.');
 assert(stdin.isTTY&&stdout.isTTY,'Interactive owner terminal required; never pipe credentials or automate this action.');
 const hostname=(await import('node:os')).hostname();
 assert(hostname==='light-remote-gold-uat','Not the Gold UAT container.');
 const claim=readClaim();
 stdout.write('Gold UAT administrative orphan recovery (never creates a terminal ACK)\n');
 stdout.write('Claimed at: '+claim.claimedAt+'; Device label: '+String(claim.deviceLabel||'unknown')+'; Device state: '+claim.deviceState+'\n');
 stdout.write('Result will remain UNKNOWN. No claim is released until authenticated owner confirmation.\n');
 const rl=createInterface({input:stdin,output:stdout,terminal:true});
 let email,bootText,reason,confirm;
 try{
  email=(await rl.question('Gold owner email: ')).trim();
  bootText=(await rl.question('Observed Windows reboot timestamp (ISO UTC, verified by owner): ')).trim();
  reason=(await rl.question('Reason (gold_agent_uninstalled / gold_agent_reinstalled): ')).trim();
  confirm=(await rl.question('Type ABANDON_UNKNOWN_RESULT to authorize audited release: ')).trim();
 }finally{rl.close();}
 assert(confirm==='ABANDON_UNKNOWN_RESULT','Owner confirmation did not match; no changes.');
 assert(['gold_agent_uninstalled','gold_agent_reinstalled'].includes(reason),'Invalid reason; no changes.');
 assert(/^[^\s@]+@[^\s@]+$/.test(email),'Invalid owner email');
 assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(bootText),'Timestamp must include UTC Z.');
 const boot=Date.parse(bootText),claimed=Date.parse(claim.claimedAt);
 assert(Number.isSafeInteger(boot)&&boot>claimed+1000&&boot<=Date.now()+300000,'Reboot timestamp not after claim, or invalid.');
 let password=await secret('Gold owner password (hidden, never written to file): ');
 let token;
 try{
  const logged=await request('/v1/accounts/login',{email,password},null);
  assert(logged.ok&&logged.token,'Gold owner login failed.');
  token=logged.token;
  assert(logged.account?.accountId===claim.accountId,'Owner login does not own the historical claim.');
  let result;
  try{
   result=await request('/v1/accounts/devices/'+encodeURIComponent(claim.deviceId)+
     '/orphan-claims/'+encodeURIComponent(claim.jobId)+'/abandon',{
      confirm,reason,observedBootAtMs:boot,password
     },token);
  }catch(error){
   // The unmodified UAT Operator cannot find an owner-removed tombstoned
   // device. ONLY this exact 404 may enter owner-authenticated local recovery.
   if(error?.message!=='Operator denied (404): device_not_found')throw error;
   const verified=await request('/v1/accounts/password-verify',{email,password},token);
   assert(verified.ok===true&&verified.account?.accountId===claim.accountId,
     'Owner password re-verification did not match the historical claim.');
   const fresh=readClaim();
   assert(fresh.jobId===claim.jobId&&fresh.deviceId===claim.deviceId&&fresh.accountId===claim.accountId,
     'Claim changed during owner authentication; refuse release.');
   await assertHistoricalChannelOffline(fresh);
   // Root never executes the owner-attested PostgreSQL release. Drop to the
   // DB peer account, then invoke the SAME reviewed typed audit transaction.
   await request('/v1/accounts/logout',{},token);
   token=undefined;
   process.setgroups([]);
   process.setgid('postgres');
   process.setuid('postgres');
   assert(process.getuid()!==0,'Refusing owner recovery with root database privileges.');
   const pool=new pg.Pool({host:'/var/run/postgresql',user:'postgres',database:'light_remote_gold_dev',max:1,
     connectionTimeoutMillis:5000});
   try{
    result=await new GoldDeviceResourceLocks().abandonOwnerAttestedOrphan(pool,{
     accountId:claim.accountId,deviceId:claim.deviceId,jobId:claim.jobId,
     observedBootAtMs:boot,reason,channelFresh:false
    });
   }finally{await pool.end();}
  }
  assert(result.released===true&&result.audited===true&&result.processOutcome==='unknown'&&result.terminalReceiptCreated===false,
   'Recovery did not certify audited UNKNOWN release. Check audit without SQL cleanup.');
  stdout.write('OWNER_ORPHAN_RELEASE_AUDITED_UNKNOWN=PASS (NO terminal ACK generated)\n');
 }finally{
  password='';
  if(token)await request('/v1/accounts/logout',{},token).catch(()=>{});
  token=undefined;
 }
}
main().catch(e=>{stderr.write('OWNER_ORPHAN_RECOVERY_STOP: '+e.message+'\n');process.exitCode=1;});
