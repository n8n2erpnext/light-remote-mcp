import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {GoldPgCoreAuthority} from '../src/storage/gold-core-authority.mjs';

const DATE=Date.parse('2026-10-17T17:00:00+07:00');
const account='acct_test_01',email='test@example.invalid';
const key=crypto.randomBytes(32);
function harness({identity=true,device=true,agentAccount=account,wall=true,paddle=null}={}){
 const calls=[],scripts=[],data={accounts:new Map(),sessions:new Map(),devices:new Map(),
  connections:new Map(),pairRequests:new Map(),grants:new Map(),oauth:new Map(),billing:new Map()};
 const emit=async(sql,params=[])=>{
  calls.push({sql,params});
  const s=String(sql);
  if(['BEGIN','COMMIT','ROLLBACK'].includes(s)||s.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};
  if(s.includes('INSERT INTO lr_accounts(')){
   const [id,mail,hash]=params;
   data.accounts.set(id,{account_id:id,email:mail,plan:'free',status:'active',
    email_verified:true,password_enabled:true,password_hash:hash});
   return{rows:[{account_id:id,email:mail,plan:'free',status:'active'}]};
  }
  if(s.includes('FROM lr_accounts WHERE lower(email)=lower($1)')){
   return{rows:[...data.accounts.values()].filter(a=>a.email===params[0])};
  }
  if(s.includes('INSERT INTO lr_sessions(')){
   const [sid,aid,hash,exp]=params;
   data.sessions.set(hash,{session_id:sid,account_id:aid,expires_at:new Date(exp),
    revoked:false});return{rows:[]};
  }
  if(s.includes('FROM lr_sessions s JOIN lr_accounts a')){
   const sess=data.sessions.get(params[0]),acc=data.accounts.get(sess?.account_id);
   return{rows:sess&&!sess.revoked&&acc?.status==='active'?
    [{...sess,email:acc.email,plan:acc.plan}]:[]};
  }
  if(s.includes('UPDATE lr_sessions SET revoked_at=now(),revoked_reason=')){
   const found=data.sessions.get(params[0]);
   if(found&&!found.revoked){found.revoked=true;return{rows:[{session_id:found.session_id}]}};
   return{rows:[]};
  }
  if(s.includes('UPDATE lr_accounts SET last_login_at'))return{rows:[]};
  if(s.includes('SELECT account_id FROM lr_accounts WHERE account_id=$1 FOR UPDATE')){
   return{rows:data.accounts.has(params[0])?[{account_id:params[0]}]:[]};
  }
  if(s.includes('UPDATE lr_accounts SET status=')){
   const acc=data.accounts.get(params[0]);acc.status='admin_disabled';return{rows:[]};
  }
  if(s.includes('WHERE account_id=$1 AND revoked_at IS NULL RETURNING session_id')){
   const revoked=[];for(const row of data.sessions.values())if(row.account_id===params[0]&&!row.revoked){
    row.revoked=true;revoked.push({session_id:row.session_id})}
   return{rows:revoked};
  }
  if((s.includes('UPDATE lr_ab_requests SET state=')&&!s.includes("state='approved'"))||s.includes('UPDATE lr_ab_grants SET closed_at')||
     s.includes('UPDATE lr_device_connections SET closed_at')||
     s.includes('DELETE FROM lr_ab_team_actor_grants'))return{rows:[]};
  if(s.includes('SELECT status FROM lr_accounts WHERE account_id=$1 FOR SHARE')){
   return{rows:[{status:data.accounts.get(params[0])?.status}]};
  }
  if(s.startsWith('SELECT owner_account_id,public_identity_key,state FROM lr_devices')){
   return{rows:data.devices.has(params[0])?[data.devices.get(params[0])]:[]};
  }
  if(s.startsWith('INSERT INTO lr_devices(')){
   const [dev,owner,node,name,pub]=params;
   const d={device_id:dev,owner_account_id:owner,node_id:node,
    display_name:name,public_identity_key:pub,state:'online'};
   data.devices.set(dev,d);return{rows:[d]};
  }
  if(s.includes('SELECT d.device_id,d.state,a.plan,a.status FROM lr_devices')){
   const device=data.devices.get(params[0]),acc=data.accounts.get(params[1]);
   return{rows:device?[{device_id:device.device_id,state:device.state,
    plan:acc.plan,status:acc.status}]:[]};
  }
  if(s.includes('SELECT connection_id,hard_expires_at FROM lr_device_connections')){
   return{rows:[...data.connections.values()].filter(c=>c.accountId===params[0]
    &&c.deviceId===params[1]).map(c=>({connection_id:c.connectionId,
     hard_expires_at:new Date(c.expiresAt)}))};
  }
  if(s.includes('COUNT(DISTINCT device_id)'))return{rows:[{count:data.connections.size}]};
  if(s.startsWith('INSERT INTO lr_device_connections(')){
   const [conn,dev,owner,plan,expiration]=params;
   data.connections.set(conn,{connectionId:conn,deviceId:dev,accountId:owner,plan,
    expiresAt:expiration});return{rows:[]};
  }
  if(s.includes('FROM lr_device_connections cn')&&s.includes('FOR UPDATE')){
   const c=data.connections.get(params[0]);
   return{rows:c?[{connection_id:c.connectionId,device_id:c.deviceId,
    account_id:c.accountId,hard_expires_at:new Date(c.expiresAt),
    status:data.accounts.get(c.accountId).status,device_state:'online'}]:[]};
  }
  if(s.startsWith('INSERT INTO lr_ab_requests(')){
   const [requestId,owner,device,connection,agent,purpose,actorAccountId,pollSha,cipher,ttlMs]=params;
   const expiration=DATE+ttlMs;
   data.pairRequests.set(requestId,{request_id:requestId,account_id:owner,
    device_id:device,connection_id:connection,agent_id:agent,purpose,
    actor_account_id:actorAccountId,
    poll_sha256:pollSha,display_code_ciphertext:cipher,expires_at:new Date(expiration),
    hard_expires_at:new Date(data.connections.get(connection).expiresAt),
    state:'pending',device_state:'online',account_status:'active',
    closed_at:null});
   return{rows:[{expires_at:new Date(expiration)}]};
  }
  if(s.includes('FROM lr_ab_requests r')&&s.includes('FOR UPDATE')){
   const found=data.pairRequests.get(params[0]);return{rows:found?[found]:[]};
  }
  if(s.startsWith('UPDATE lr_ab_requests SET failed_attempts')){
   const row=data.pairRequests.get(params[0]);row.failed_attempts=(row.failed_attempts||0)+1;
   if(row.failed_attempts>=5)row.state='denied';return{rows:[]};
  }
  if(s.startsWith('INSERT INTO lr_ab_grants(')){
   const [grant,owner,dev,conn,agent,purpose]=params;
   data.grants.set(grant,{grant_id:grant,owner,purpose,device_id:dev,connection_id:conn,agent_id:agent});
   return{rows:[]};
  }
  if(s.startsWith("UPDATE lr_ab_requests SET state='approved'")){
   const row=data.pairRequests.get(params[0]);row.state='approved';
   row.approved_grant_id=params[1];
   return{rows:[{request_id:params[0]}]};
  }
  if(s.includes('FROM lr_ab_requests r')&&s.includes('r.poll_sha256=$1')){
   const digest=params[0],agentId=params[1];
   const request=[...data.pairRequests.values()].find(r=>
    r.poll_sha256===digest&&r.agent_id===agentId);
   if(!request)return{rows:[]};
   const grant=data.grants.get(request.approved_grant_id);
   return{rows:[{...request,owner_status:'active',device_state:'online',
    connection_closed_at:null,grant_closed_at:grant?.closed_at||null,
    grant_expires_at:grant?new Date(DATE+3600000):null,
    absolute_expires_at:grant?new Date(DATE+86400000):null}]};
  }
  if(s.includes('FROM lr_ab_grants g')&&s.includes('owner.status')){
   const [grant,dev,conn,agent,actor]=params,g=data.grants.get(grant);
   return{rows:g&&g.owner===actor&&g.device_id===dev&&g.connection_id===conn&&g.agent_id===agent?
    [{owner:g.owner,purpose:g.purpose}]:[]};
  }
  if(s.includes('FROM lr_accounts ')&&s.includes("status='active' RETURNING token_sha256")){
   const [hash,purpose,owner,client,expiresAt]=params;
   if(data.accounts.get(owner)?.status!=='active')return{rows:[]};
   data.oauth.set(hash,{purpose,owner,client,expiresAt,used:false});
   return{rows:[{token_sha256:hash}]};
  }
  if(s.startsWith('UPDATE lr_oauth_one_time t')){
   const [hash,purpose,client]=params,row=data.oauth.get(hash);
   if(!row||row.used||row.purpose!==purpose||row.client!==client)return{rows:[]};
   row.used=true;return{rows:[{account_id:row.owner}]};
  }
  if(s.includes("WHERE provider='paddle' AND provider_event_id=$1 FOR UPDATE")){
   const item=data.billing.get(params[0]);return{rows:item?[item]:[]};
  }
  if(s.startsWith('INSERT INTO lr_billing_events(')){
   const [event,owner,txn,kind,amount,currency,providerEvent]=params;
   data.billing.set(providerEvent,{event_id:event,owner_account_id:owner,kind});
   return{rows:[{event_id:event}]};
  }
  throw Error('unexpected_sql: '+s.slice(0,130));
 };
 const pool={query:emit,connect:async()=>({query:emit,release:()=>{}})};
 const authority=new GoldPgCoreAuthority({pool,now:()=>DATE,
  verifyIdentityProof:async()=>identity,verifyDeviceProof:async()=>device,
  verifyAgentPrincipal:async()=>({accountId:agentAccount}),
  verifyWallApproval:async()=>wall,verifyPaddleSignature:async()=>paddle,
  pairingEncryptionKey:key});
 return {authority,data,calls,pool};
}
test('Gold Core constructors require server-authorized proof callbacks and key',()=>{
 assert.throws(()=>new GoldPgCoreAuthority({pool:{query(){},connect(){}}}),
  /gold_core_trusted_verifier_required/);
 assert.throws(()=>new GoldPgCoreAuthority({
  pool:{query(){},connect(){}},verifyIdentityProof:()=>true,
  verifyDeviceProof:()=>true,verifyAgentPrincipal:()=>true,
  verifyWallApproval:()=>true,verifyPaddleSignature:()=>true,
 }),/gold_core_pairing_key_required/);
});
test('Account signup/login/PG-session/logout uses hashed password and SHA-only bearer',async()=>{
 const {authority:a,data,calls}=harness();
 const created=await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 assert.equal(created.account_id,account);
 assert.match(data.accounts.get(account).password_hash,/^scrypt\$/);
 assert(!calls.some(x=>JSON.stringify(x.params).includes('StrongPass#123')));
 await assert.rejects(()=>a.login({email,password:'wrong-password'}),/gold_login_invalid/);
 const logged=await a.login({email,password:'StrongPass#123'});
 assert.equal(logged.account.accountId,account);
 assert(![...data.sessions.keys()].includes(logged.token));
 assert.equal((await a.authenticate(logged.token)).accountId,account);
 assert.equal((await a.logout(logged.token)).loggedOut,true);
 await assert.rejects(()=>a.authenticate(logged.token),/gold_auth_invalid_session/);
});
test('Core disables accounts transactionally, invalidates sessions and A/B state',async()=>{
 const {authority:a,data,calls}=harness();
 await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 const user=await a.login({email,password:'StrongPass#123'});
 const res=await a.disableAccount({accountId:account,actorAccountId:'acct_admin',proof:'root-trusted'});
 assert.equal(res.status,'admin_disabled');
 assert.equal(data.accounts.get(account).status,'admin_disabled');
 await assert.rejects(()=>a.authenticate(user.token),/gold_auth_invalid_session/);
 assert(calls.some(c=>c.sql.includes('UPDATE lr_ab_grants SET closed_at')));
 assert(calls.some(c=>c.sql.includes('UPDATE lr_device_connections SET closed_at')));
});
test('Device registration is proven and reconnect returns same connection under account cap',async()=>{
 const {authority:a,data}=harness();
 await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 const logged=await a.login({email,password:'StrongPass#123'});
 const device=await a.registerDevice({sessionToken:logged.token,deviceId:'dev_mac',nodeId:'node_mac',
  publicIdentityKey:'public-test-key',proof:'signed-device'});
 assert.equal(device.owner_account_id,account);
 const connected=await a.connectDevice({sessionToken:logged.token,deviceId:'dev_mac'});
 assert(connected.connectionId.startsWith('conn_'));
 const reused=await a.connectDevice({sessionToken:logged.token,deviceId:'dev_mac'});
 assert.equal(reused.connectionId,connected.connectionId);
 assert.equal(reused.reused,true);
 assert.equal(data.connections.size,1);
});
test('A/B requires agent authority, local Wall proof, one-time code, then scoped grant',async()=>{
 const {authority:a,data}=harness();
 await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 const logged=await a.login({email,password:'StrongPass#123'});
 await a.registerDevice({sessionToken:logged.token,deviceId:'dev_mac',nodeId:'node_mac',
  publicIdentityKey:'public-test-key',proof:'signed-device'});
 const conn=await a.connectDevice({sessionToken:logged.token,deviceId:'dev_mac'});
 const request=await a.requestPairing({connectionId:conn.connectionId,
  agentId:'agent-chatgpt',agentProof:'server-signed'});
 assert.match(request.approvalCode,/^[0-9A-F]{5}-[0-9A-F]{5}$/);
 assert.deepEqual(await a.pollPairing({pollToken:request.pollToken,
   agentId:'agent-chatgpt',agentProof:'server-signed'}),{state:'pending'});
 assert(!JSON.stringify([...data.pairRequests.values()].map(x=>({
  request_id:x.request_id,poll_sha256:x.poll_sha256}))).includes(request.pollToken));
 await assert.rejects(()=>a.approvePairing({requestId:request.requestId,
  approvalCode:'WRONG-CODE',wallContext:{local:true}}),/gold_ab_code_invalid/);
 const result=await a.approvePairing({requestId:request.requestId,
  approvalCode:request.approvalCode,wallContext:{local:true}});
 assert(result.approved);
 const recovered=await a.pollPairing({pollToken:request.pollToken,
  agentId:'agent-chatgpt',agentProof:'server-signed'});
 assert.equal(recovered.state,'approved');
 assert.equal(recovered.grantId,result.grantId);
 await assert.rejects(()=>a.pollPairing({pollToken:'A'.repeat(43),
   agentId:'agent-chatgpt',agentProof:'server-signed'}),/gold_ab_poll_inactive_or_unknown/);
 assert.equal((await a.authorizeGrant({grantId:result.grantId,actorAccountId:account,
  deviceId:'dev_mac',connectionId:conn.connectionId,agentId:'agent-chatgpt'})).allowed,true);
 await assert.rejects(()=>a.approvePairing({requestId:request.requestId,
  approvalCode:request.approvalCode,wallContext:{local:true}}),/gold_ab_expired_or_consumed/);
 // The hash-only polling capability cannot be moved to another Account,
 // and an already granted device must disappear immediately on revocation.
 a.verifyAgentPrincipal=async()=>({accountId:'acct_stolen'});
 await assert.rejects(()=>a.pollPairing({pollToken:request.pollToken,
  agentId:'agent-chatgpt',agentProof:'stolen'}),/gold_ab_poll_account_mismatch/);
 a.verifyAgentPrincipal=async()=>({accountId:account});
 data.grants.get(result.grantId).closed_at=new Date(DATE);
 assert.deepEqual(await a.pollPairing({pollToken:request.pollToken,
  agentId:'agent-chatgpt',agentProof:'server-signed'}),{state:'closed'});
});
test('OAuth one-time tokens are hashed and consumed exactly once',async()=>{
 const {authority:a,data}=harness();
 await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 const item=await a.issueOAuth({purpose:'authorization_code',accountId:account,clientId:'client1'});
 assert(![...data.oauth.keys()].includes(item.token));
 assert.deepEqual(await a.consumeOAuth({purpose:'authorization_code',token:item.token,
  clientId:'client1'}),{accountId:account});
 await assert.rejects(()=>a.consumeOAuth({purpose:'authorization_code',token:item.token,
  clientId:'client1'}),/gold_oauth_expired_or_replayed/);
});
test('Paddle webhook can only be recorded following verified signature callback',async()=>{
 const fake={eventId:'evt_checkout_01',ownerAccountId:account,
  providerEventId:'paddle_ev_01',kind:'payment',amountMinor:2000,currency:'USD'};
 const invalid=harness({paddle:null});
 await assert.rejects(()=>invalid.authority.ingestPaddle({payload:'{}',signature:'invalid'}),
  /gold_paddle_signature_invalid/);
 const {authority:a,data}=harness({paddle:fake});
 await a.registerVerifiedAccount({accountId:account,email,password:'StrongPass#123',proof:'verified'});
 const res=await a.ingestPaddle({payload:'signature-verified',signature:'good'});
 assert.equal(res.recorded,true);
 assert.equal((await a.ingestPaddle({payload:'signature-verified',signature:'good'})).duplicate,true);
 assert.equal(data.billing.size,1);
});
test('Invalid proof denies registration before any SQL mutation',async()=>{
 const {authority:a,calls}=harness({identity:false});
 await assert.rejects(()=>a.registerVerifiedAccount({accountId:account,email,
  password:'StrongPass#123',proof:'not-valid'}),/gold_verified_email_proof_required/);
 assert.deepEqual(calls.map(x=>x.sql),['BEGIN','ROLLBACK']);
});
