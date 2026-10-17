import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgRemoteSessionAuthority} from '../src/storage/gold-remote-session-authority.mjs';

const EPOCH=Date.parse('2026-10-17T12:00:00.000Z');
const ACTOR='acct_owner',OWNER='acct_owner',DEVICE='dev_owner';
const AGENT='agent_chat',CLIENT='lrc_verified',GRANT='grant_active';

function fixture({purpose='device',actor=ACTOR,now=EPOCH,
 verified=true,teamActive=true,grantLive=true,pgDown=false}={}){
 const log=[],records=new Map(),state={purpose,actor,now,verified,teamActive,grantLive,pgDown,bindingChanged:false,
  grantId:GRANT,connectionId:'conn_active',upstreamExpiryMs:null};
 let counter=0;
 const client={query:async(sql,p=[])=>{
  log.push({sql,p});
  if(state.pgDown)throw Error('gold_pg_offline');
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||
     sql.includes('SELECT pg_advisory_xact_lock('))return{rows:[]};
  if(sql.includes('FROM lr_ab_grants g')){
   return{rows:state.grantLive?[{
    grant_id:state.grantId,owner_account_id:OWNER,purpose:state.purpose,
    device_id:DEVICE,connection_id:state.connectionId,node_id:'node_home',
    grant_expires_at:new Date(state.upstreamExpiryMs??state.now+3600000),
    absolute_expires_at:new Date(state.now+86400000),
    client_expires_at:new Date(state.now+86400000),
    hard_expires_at:new Date(state.now+3600000)}]:[]};
  }
  if(sql.includes('SELECT tag.grant_id FROM lr_ab_team_actor_grants'))
   return{rows:state.teamActive?[{grant_id:GRANT}]:[]};
  if(sql.startsWith('SELECT grant_id FROM lr_agent_bindings')||
     sql.startsWith('SELECT grant_id FROM lr_agent_team_bindings'))
   return{rows:state.bindingChanged?[]:[{grant_id:GRANT}]};
  if(sql.startsWith('SELECT * FROM lr_remote_sessions')){
   return{rows:[...records.values()].filter(row=>
    row.actor_account_id===p[0]&&row.agent_id===p[1]&&
    row.device_id===p[2]&&!row.closed_at)};
  }
  if(sql.startsWith('UPDATE lr_remote_sessions SET closed_at=')){
   const old=records.get(p[0]);old.closed_at=new Date(state.now);
   return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO lr_remote_sessions')){
   const row={session_id:p[0],client_session_id:p[1],
    actor_account_id:p[2],owner_account_id:p[3],agent_id:p[4],
    device_id:p[5],node_id:p[6],connection_id:p[7],grant_id:p[8],
    grant_purpose:p[9],workspace:p[10],grace_preset:p[11],grace_ms:p[12],
    expires_at:new Date(p[13]),last_seen_at:new Date(state.now),reconnect_count:0};
   records.set(p[0],row);counter++;return{rows:[row]};
  }
  if(sql.startsWith('UPDATE lr_remote_sessions SET client_session_id=')){
   const old=records.get(p[0]);Object.assign(old,{
    client_session_id:p[1],owner_account_id:p[2],
    connection_id:p[3],grant_id:p[4],grant_purpose:p[5],
    node_id:p[6],workspace:p[7],grace_preset:p[8],grace_ms:p[9],
    expires_at:new Date(p[10]),last_seen_at:new Date(state.now),
    reconnect_count:old.reconnect_count+1
   });return{rows:[old]};
  }
  throw Error('unmocked_gold_remote_session_sql '+sql.slice(0,100));
 },release(){}};
 const pool={connect:async()=>client};
 const resolved=[];
 const agentClients={resolve:async value=>{
  resolved.push(value);
  if(!state.verified)throw Object.assign(Error('gold_agent_ingress_unverified'),
   {status:401});
  return{binding:{
   clientSessionId:CLIENT,accountId:state.actor,agentId:AGENT,
   deviceId:DEVICE,grantId:state.grantId,connectionId:state.connectionId,
   purpose:state.purpose
  },device:{nodeId:'node_home',platform:'linux',architecture:'arm64',
   state:'online'},connection:{state:'connected'}};
 }};
 const svc=new GoldPgRemoteSessionAuthority({pool,agentClients,now:()=>state.now});
 const input={clientSessionId:CLIENT,agentId:AGENT,agentProof:'signed'};
 return{svc,state,input,log,records,resolved,get creates(){return counter}};
}
test('Gold remote-session authority requires PostgreSQL and verified Agent binding',()=>{
 assert.throws(()=>new GoldPgRemoteSessionAuthority(),/gold_remote_session_pg_pool_required/);
 assert.throws(()=>new GoldPgRemoteSessionAuthority({pool:{connect(){}}}),
  /gold_remote_session_agent_binding_required/);
});
test('Gold opens one durable remote workspace, reuses it without changing device',async()=>{
 const f=fixture();
 const first=await f.svc.context({...f.input,workspace:'/home/user/project',
  gracePreset:'30m',deviceId:DEVICE});
 assert.match(first.session.sessionId,/^s_[a-z0-9]+_[a-f0-9]{16}$/);
 assert.equal(first.session.accountId,ACTOR);
 assert.equal(first.session.graceMs,1800000);
 assert.equal(first.context.nodeId,'node_home');
 assert.equal(first.context.workspace,'/home/user/project');
 assert(f.log.some(q=>q.sql.includes('FOR SHARE OF g,cn,d,ac,actor,owner')));
 const reused=await f.svc.context({...f.input});
 assert.equal(reused.session.sessionId,first.session.sessionId);
 assert.equal(reused.session.workspace,'/home/user/project');
 assert.equal(reused.session.gracePreset,'30m');
 assert.equal(reused.session.reconnectCount,1);
 assert.equal(f.creates,1);
 assert(f.log.some(q=>q.sql.includes('pg_advisory_xact_lock')));
 assert.equal(f.log.at(-1).sql,'COMMIT');
});
test('Gold expired remote workspace closes and creates new session, never reuses expired ID',async()=>{
 const f=fixture();
 const first=await f.svc.context({...f.input,workspace:'/opt/source',gracePreset:'15m'});
 f.state.now+=900001;
 const second=await f.svc.context({...f.input,workspace:'/opt/new'});
 assert.notEqual(first.session.sessionId,second.session.sessionId);
 assert.equal(second.session.gracePreset,'60m');
 assert.equal(f.creates,2);
 assert(f.records.get(first.session.sessionId).closed_at);
});
test('Gold Team workspace binds actor to member, checks share again under transaction',async()=>{
 const f=fixture({purpose:'team-member',actor:'acct_member'});
 const entered=await f.svc.context({...f.input,deviceId:DEVICE});
 assert.equal(entered.session.accountId,'acct_member');
 assert.equal(entered.session.ownerAccountId,OWNER);
 assert(f.log.some(entry=>entry.sql.includes('lr_entitlements team_ent')),
  'Team remote context cannot outlive owner paid Pro entitlement');
 f.state.teamActive=false;
 const count=f.creates;
 await assert.rejects(()=>f.svc.context({...f.input}),
  /gold_context_team_access_revoked/);
 assert.equal(f.creates,count);
 assert.equal(f.log.at(-1).sql,'ROLLBACK');
});
test('Gold refuses revoked grant, invalid grace, forged principal and unavailable PG',async()=>{
 const f=fixture();
 f.state.verified=false;
 await assert.rejects(()=>f.svc.context(f.input),/gold_agent_ingress_unverified/);
 assert.equal(f.log.length,0);
 f.state.verified=true;
 await assert.rejects(()=>f.svc.context({...f.input,gracePreset:'always'}),
  /gold_context_grace_preset_invalid/);
 assert.equal(f.log.length,0);
 f.state.grantLive=false;
 await assert.rejects(()=>f.svc.context(f.input),/gold_context_grant_expired_or_revoked/);
 assert.equal(f.log.at(-1).sql,'ROLLBACK');
 f.state.grantLive=true;
 f.state.bindingChanged=true;
 await assert.rejects(()=>f.svc.context(f.input),/gold_context_binding_changed/);
 f.state.bindingChanged=false;f.state.pgDown=true;
 await assert.rejects(()=>f.svc.context(f.input),/gold_pg_offline/);
});

test('Gold session cannot inherit a different A/B grant or device connection after re-approval',async()=>{
 const f=fixture();
 const first=await f.svc.context({...f.input,workspace:'/work/project',gracePreset:'60m'});
 const firstSession=first.session.sessionId;
 f.state.grantId='grant_reapproved';
 const reapproved=await f.svc.context({...f.input});
 assert.notEqual(reapproved.session.sessionId,firstSession);
 assert.equal(reapproved.session.workspace,'');
 assert.equal(reapproved.session.reconnectCount,0);
 assert(f.records.get(firstSession).closed_at);
 assert(f.log.some(q=>q.sql.startsWith('UPDATE lr_remote_sessions SET closed_at=')&&
  q.p[1]==='authorization_changed'));
 const secondId=reapproved.session.sessionId;
 f.state.connectionId='conn_reconnected';
 const reconnection=await f.svc.context({...f.input});
 assert.notEqual(reconnection.session.sessionId,secondId);
 assert(f.records.get(secondId).closed_at);
 assert.equal(f.creates,3);
});
test('Gold remote session TTL is bounded by upstream A/B lease, not just client grace',async()=>{
 const f=fixture();
 f.state.upstreamExpiryMs=EPOCH+120000;
 const first=await f.svc.context({...f.input,gracePreset:'60m'});
 assert.equal(first.session.expiresAt,EPOCH+120000);
 f.state.now=EPOCH+120001;
 await assert.rejects(()=>f.svc.context(f.input),/gold_context_upstream_lease_expired/);
 assert.equal(f.log.at(-1).sql,'ROLLBACK');
});
