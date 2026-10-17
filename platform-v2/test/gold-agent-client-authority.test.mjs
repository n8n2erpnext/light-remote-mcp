import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgAgentClientAuthority} from '../src/storage/gold-agent-client-authority.mjs';
const NOW=Date.parse('2026-10-17T12:00:00Z');
const OWNER='acct_owner',MEMBER='acct_member',DEVICE='dev_owner',AGENT='agent_chat';
const grant='grant_owner_1',connection='conn_owner_1';

function fixture({purpose='device',actorAccountId=OWNER,memberActive=true,
 ownerActive=true,actorActive=true,deviceState='online',wrongAgent=false}={}){
 const events=[],sessions=new Map(),direct=new Map(),team=new Map();
 const state={purpose,memberActive,ownerActive,actorActive,deviceState,
  wrongAgent,requestsValid:true,closedGrant:false};
 const query=async(sql,p=[])=>{
  events.push({sql,p});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return{rows:[]};
  if(sql.includes('FROM lr_ab_grants g JOIN lr_device_connections cn')){
   if(state.closedGrant)return{rows:[]};
   return{rows:[{grant_id:grant,owner_account_id:OWNER,device_id:DEVICE,
    connection_id:connection,agent_id:AGENT,purpose:state.purpose,
    expires_at:new Date(NOW+3600000),absolute_expires_at:new Date(NOW+86400000),
    hard_expires_at:new Date(NOW+86400000),
    state:state.deviceState,node_id:'node_owner',display_name:'Home server',
    platform:'linux',architecture:'x64',
    owner_status:state.ownerActive?'active':'admin_disabled',
    actor_status:state.actorActive?'active':'admin_disabled'}]};
  }
  if(sql.includes('SELECT tag.team_id FROM lr_ab_team_actor_grants'))
   return{rows:state.memberActive?[{team_id:'team_owner'}]:[]};
  if(sql.includes('SELECT request_id FROM lr_ab_requests'))
   return{rows:state.requestsValid?[{request_id:p[0]}]:[]};
  if(sql.startsWith('INSERT INTO lr_agent_clients(')){
   sessions.set(p[0],{client_session_id:p[0],account_id:p[1],
    agent_id:p[2],expires_at:new Date(p[3]),default_device_id:null,
    status:'active',closed_at:null});
   return{rows:[{client_session_id:p[0],expires_at:new Date(p[3])}]};
  }
  if(sql.includes('FROM lr_agent_clients WHERE client_session_id=$1 FOR UPDATE')){
   const row=sessions.get(p[0]);return{rows:row?[row]:[]};
  }
  if(sql.startsWith('DELETE FROM lr_agent_bindings')){
   direct.delete(p[0]+':'+p[1]);return{rows:[]};
  }
  if(sql.startsWith('DELETE FROM lr_agent_team_bindings')){
   team.delete(p[0]+':'+p[1]);return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO lr_agent_bindings(')){
   assert.equal(p[5],OWNER);direct.set(p[0]+':'+p[1],{client_session_id:p[0],
    device_id:p[1],grant_id:p[2],connection_id:p[3],pairing_request_id:p[4]});
   return{rows:[]};
  }
  if(sql.startsWith('INSERT INTO lr_agent_team_bindings(')){
   assert.equal(p[1],MEMBER);assert.equal(p[2],OWNER);
   team.set(p[0]+':'+p[3],{client_session_id:p[0],device_id:p[3],
    grant_id:p[5],connection_id:p[4],pairing_request_id:p[6]});
   return{rows:[]};
  }
  if(sql.startsWith('UPDATE lr_agent_clients SET')){
   const row=sessions.get(p[0]);
   row.default_device_id=p[1];row.expires_at=new Date(p[2]);
   return{rows:[{expires_at:row.expires_at}]};
  }
  if(sql.includes('FROM lr_agent_clients ac JOIN lr_accounts actor')){
   const row=sessions.get(p[0]);return{rows:row?[row]:[]};
  }
  if(sql.includes('FROM lr_agent_bindings b')){
   const b=direct.get(p[0]+':'+p[1]);
   return{rows:b&&!state.closedGrant&&state.actorActive&&state.ownerActive?
    [{...b,node_id:'node_owner',display_name:'Home server',state:'online',
      platform:'linux',architecture:'x64',
      hard_expires_at:new Date(NOW+86400000),grant_expires_at:new Date(NOW+3600000)}]:[]};
  }
  if(sql.includes('FROM lr_agent_team_bindings b')){
   const b=team.get(p[0]+':'+p[1]);
   return{rows:b&&state.memberActive&&!state.closedGrant&&state.actorActive&&state.ownerActive?
    [{...b,node_id:'node_owner',display_name:'Home server',state:'online',
      platform:'linux',architecture:'x64',
      hard_expires_at:new Date(NOW+86400000),grant_expires_at:new Date(NOW+3600000)}]:[]};
  }
  if(sql.startsWith('UPDATE lr_agent_bindings SET')||
     sql.startsWith('UPDATE lr_agent_team_bindings SET'))return{rows:[]};
  throw Error('unmocked_gold_agent_sql '+sql.slice(0,120));
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const authority=new GoldPgAgentClientAuthority({pool,now:()=>NOW,
  verifyAgentPrincipal:async({agentId})=>agentId===AGENT&&!state.wrongAgent?
   {accountId:actorAccountId}:null});
 const input={agentId:AGENT,agentProof:'trusted-agent',grantId:grant,
  pairingRequestId:'ab_owner_1'};
 return{authority,events,sessions,direct,team,state,input};
}

test('Gold Agent Client requires PostgreSQL, verified Agent and safe TTL',()=>{
 assert.throws(()=>new GoldPgAgentClientAuthority(),/gold_agent_pg_pool_required/);
 assert.throws(()=>new GoldPgAgentClientAuthority({
  pool:{query(){},connect(){}}}),/gold_agent_proof_verifier_required/);
 assert.throws(()=>new GoldPgAgentClientAuthority({pool:{query(){},connect(){}},
  verifyAgentPrincipal:()=>true,ttlMs:100}),/gold_agent_invalid_client_ttl/);
});
test('Owner Agent attach and resolve use legacy owner-only PostgreSQL binding with live grant',async()=>{
 const f=fixture(),result=await f.authority.attach(f.input);
 assert.match(result.client.clientSessionId,/^lrc_/);
 assert.equal(result.purpose,'device');
 assert.equal(f.direct.size,1);assert.equal(f.team.size,0);
 assert(f.events.some(e=>e.sql.includes("VALUES($1,$2,$3,$4,$5,$6,'device')")));
 assert.equal(f.events.at(-1).sql,'COMMIT');
 const bound=await f.authority.resolve({agentId:AGENT,agentProof:'agent',
  clientSessionId:result.client.clientSessionId,deviceId:DEVICE});
 assert.equal(bound.binding.grantId,grant);
 assert.equal(bound.binding.accountId,OWNER);
 assert.equal(bound.binding.purpose,'device');
 assert.equal(bound.device.nodeId,'node_owner');
 assert(f.events.some(e=>e.sql.includes("g.purpose='device'")));
 f.state.closedGrant=true;
 await assert.rejects(()=>f.authority.resolve({agentId:AGENT,
  clientSessionId:result.client.clientSessionId}),/gold_agent_binding_expired_or_revoked/);
 assert.equal(f.events.at(-1).sql,'ROLLBACK');
});
test('Team member binding uses dedicated table and never impersonates owner Account',async()=>{
 const f=fixture({purpose:'team-member',actorAccountId:MEMBER});
 const created=await f.authority.attach(f.input);
 assert.equal(created.purpose,'team-member');
 assert.equal(f.direct.size,0);assert.equal(f.team.size,1);
 const bound=await f.authority.resolve({agentId:AGENT,
  clientSessionId:created.client.clientSessionId,deviceId:DEVICE});
 assert.equal(bound.binding.accountId,MEMBER);
 assert.equal(bound.binding.purpose,'team-member');
 assert(f.events.some(e=>e.sql.includes("g.purpose='team-member'")));
 // Both membership and the underlying 24h wall grant remain live checks.
 f.state.memberActive=false;
 await assert.rejects(()=>f.authority.resolve({agentId:AGENT,
  clientSessionId:created.client.clientSessionId}),/gold_agent_binding_expired_or_revoked/);
 assert.equal(f.events.at(-1).sql,'ROLLBACK');
});
test('Gold Agent refuses Team member on owner-only grant and fails before creating sessions',async()=>{
 const f=fixture({purpose:'device',actorAccountId:MEMBER});
 await assert.rejects(()=>f.authority.attach(f.input),/gold_agent_owner_actor_mismatch/);
 assert.equal(f.sessions.size,0);
 const g=fixture({purpose:'team-member',actorAccountId:MEMBER,memberActive:false});
 await assert.rejects(()=>g.authority.attach(g.input),/gold_agent_team_access_revoked/);
 assert(!g.events.some(e=>e.sql.startsWith('INSERT INTO lr_agent_clients')));
});
test('Gold Agent refuses stale or forged pairing request and identity crossover',async()=>{
 const f=fixture();f.state.requestsValid=false;
 await assert.rejects(()=>f.authority.attach(f.input),/gold_agent_pairing_request_mismatch/);
 assert.equal(f.direct.size,0);
 f.state.requestsValid=true;
 const a=await f.authority.attach(f.input);
 const t=fixture({purpose:'team-member',actorAccountId:MEMBER});
 await assert.rejects(()=>t.authority.attach({...t.input,
  clientSessionId:a.client.clientSessionId}),/gold_agent_client_invalid_or_expired/);
 const refused=fixture({wrongAgent:true});
 await assert.rejects(()=>refused.authority.attach(refused.input),/gold_agent_ingress_unverified/);
 assert.equal(refused.events.length,0);
});
test('Gold schema 019 preserves historical owner-only constraint and adds relational Team binding',async()=>{
 const fs=await import('node:fs');
 const root=new URL('../../infra/pgredis/migrations/',import.meta.url);
 const old=fs.readFileSync(new URL('004_tenant_binding_guards.sql',root),'utf8');
 const next=fs.readFileSync(new URL('019_gold_team_agent_binding.sql',root),'utf8');
 assert(old.includes("lr_binding_direct_grant_only"));
 assert(next.includes('CREATE TABLE IF NOT EXISTS lr_agent_team_bindings'));
 for(const name of ['lr_agent_clients(client_session_id,account_id)',
  'lr_ab_team_actor_grants(grant_id,actor_account_id,device_id)',
  'lr_ab_grants(grant_id,device_id,connection_id,account_id,purpose)'])
  assert(next.includes(name),'missing strict binding FK: '+name);
 assert(next.includes("CHECK(grant_purpose='team-member')"));
 assert(next.includes('REFERENCES lr_ab_requests(request_id,approved_grant_id)'));
 assert(next.includes('ON lr_ab_requests(request_id,approved_grant_id)'));
});
