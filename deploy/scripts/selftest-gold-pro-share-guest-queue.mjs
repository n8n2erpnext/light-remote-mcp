import assert from 'node:assert/strict';
import {stableGoldV2AgentId} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {GoldProShareGuestQueuePg} from '../../operator-host/pro-share-guest-queue-pg.mjs';
import {createGoldProShareDispatchGate} from '../../operator-host/pro-share-dispatch-gate.mjs';
const oauthToken=Object.freeze({opaque:true});
const otherToken=Object.freeze({opaque:'foreign'});
const guest={verified:true,accountId:'guest1',
 clientId:'oauth-b2-'+('a'.repeat(40))};
const agent=stableGoldV2AgentId(guest);
const rows=new Map(),byKey=new Map(),queryLog=[];
let active=true,verifiedFree=true,seatRevision=7,grantPurpose='pro-share-guest',
 currentConnection='connection1',bindingsRevoked=false,slotsCreated=0,
 time=1850000000000,wrongGrant=false;
const device={deviceId:'device1',accountId:'owner1',nodeId:'node1',state:'online'};
const context=()=>({device,connection:{
 deviceId:'device1',accountId:'owner1',
 connectionId:currentConnection,hardExpiresAt:time+100000,state:'connected'},
 nodeId:'node1',guestNativeProtocol:'signed-pro-share-guest-v1',approvedCapabilities:['filesystem'],
 routeCapabilities:['filesystem']});
const binding=()=>({deviceId:'device1',grantPurpose,
 grantId:wrongGrant?'grantWrong':'grant1',
 connectionId:currentConnection});
const clientRows=()=>({clientSessionId:'lrc_guest_1',
 accountId:'guest1',agentId:agent,bindings:bindingsRevoked?[]:[binding()]});
const accountClients={findActive({accountId,agentId}){
 assert.equal(accountId,'guest1');
 assert.equal(agentId,agent);
 if(!active)throw Error('oauth_client_closed');
 return clientRows();
}};
const store={async authorizeOperation({authenticatedActorAccountId,
 authenticatedAgentId,device:d,connection,grantId,
 requiredCapabilities,operation}){
 assert.equal(authenticatedActorAccountId,'guest1');
 assert.equal(authenticatedAgentId,agent);
 assert.equal(d.accountId,'owner1');
 if(connection.connectionId!=='connection1')throw Error('connection_changed');
 if(grantId!=='grant1')throw Error('guest_ab_grant_denied');
 if(!active)throw Error('guest_revoked');
 assert.ok(requiredCapabilities.includes('filesystem'));
 assert.equal(operation,'exec');
 return {actorAccountId:'guest1',agentId:agent,grantId,
  deviceId:'device1',billedAccountId:'owner1',
  connectionId:'connection1',permissionRevision:seatRevision,
  accessExpiresAt:time+50000,maxGuestConcurrentJobs:1,
  requiredCapabilities:['filesystem']};
}};
const poolQuery=async(sql,args=[])=>{
 const q=sql.replace(/\s+/g,' ').trim();
 queryLog.push({q,args});
 if(q==='BEGIN'||q==='COMMIT'||q==='ROLLBACK'||q.includes('pg_advisory_xact_lock'))
  return {rowCount:0,rows:[]};
 if(q.startsWith('SELECT * FROM lr_gold_pro_share_guest_jobs WHERE guest_account_id=')){
  const key=[args[0],args[1],args[2]].join('|');
  const row=byKey.get(key);return {rowCount:row?1:0,rows:row?[{...row}]:[]};
 }
 if(q.startsWith('SELECT count(*)::int AS n FROM lr_gold_pro_share_guest_jobs')){
  return {rowCount:1,rows:[{n:[...rows.values()].filter(x=>x.guest_account_id===args[0]&&x.state==='queued').length}]};
 }
 if(q.startsWith('INSERT INTO lr_gold_pro_share_guest_jobs')){
  const [jobId,opId,requestKey,owner,actor,agentId,clientSessionId,deviceId,grantId,
   conn,operation,caps,revision]=args;
  const row={job_id:jobId,operation_id:opId,request_key:requestKey,
   owner_account_id:owner,guest_account_id:actor,agent_id:agentId,
   client_session_id:clientSessionId,device_id:deviceId,
   grant_id:grantId,connection_id:conn,operation,
   required_capabilities:[...caps],permission_revision:revision,state:'queued'};
  rows.set(jobId,row);byKey.set([actor,agentId,requestKey].join('|'),row);
  return {rowCount:1,rows:[{...row}]};
 }
 if(q.startsWith('SELECT * FROM lr_gold_pro_share_guest_jobs WHERE job_id=')){
  const row=rows.get(args[0]);return {rowCount:row?1:0,rows:row?[{...row}]:[]};
 }
 if(q.startsWith('UPDATE lr_gold_pro_share_guest_jobs SET state=')){
  const [jobId,actor,agentId]=args,row=rows.get(jobId);
  if(!row||row.guest_account_id!==actor||row.agent_id!==agentId||
     row.state!=='queued'||slotsCreated>0)return {rowCount:0,rows:[]};
  row.state='cancelled';return {rowCount:1,rows:[{job_id:jobId}]};
 }
 throw Error('unexpected_SQL:'+q.slice(0,120));
};
const pg={query:poolQuery,connect:async()=>({query:poolQuery,release(){}})};
const args={pool:pg,env:{LR_GOLD_PRO_SHARE_CORE:'1',
 LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1'},
 authenticateOAuth:async token=>token===oauthToken?guest:null,
 accountActive:x=>x==='guest1'&&active,
 guestVerifiedFree:x=>x==='guest1'&&verifiedFree,
 loadFreshContext:async x=>x==='device1'?context():null,
 store,accessGrants:{assert(){}},agentClients:accountClients,now:()=>time};
const make=()=>new GoldProShareGuestQueuePg(args);
const disabled=new GoldProShareGuestQueuePg({...args,env:{}});
await assert.rejects(disabled.enqueue({opaqueOAuthContext:oauthToken}),
 /guest_queue_disabled/);
assert.throws(()=>new GoldProShareGuestQueuePg({...args,env:{
 LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',LR_GOLD_PRO_SHARE_CORE:'1'}}),
 /guest_queue_prerequisites_disabled/);
assert.throws(()=>new GoldProShareGuestQueuePg({...args,authenticateOAuth:null}),
 /guest_queue_dependencies_missing/);
const queue=make(),clone=make();
const key='a'.repeat(32);
const base={opaqueOAuthContext:oauthToken,deviceId:'device1',requestKey:key,
 operation:'exec',requiredCapabilities:['filesystem','filesystem']};
await assert.rejects(queue.enqueue({...base,opaqueOAuthContext:{...guest,verified:true}}),
 /guest_queue_verified_oauth_required/);
await assert.rejects(queue.enqueue({...base,requiredCapabilities:[]}),
 /guest_queue_required_capability_missing/);
const created=await queue.enqueue(base);
assert.equal(created.reused,false);
assert.equal(created.job.identitySource,'verified-oauth');
assert.equal(created.job.actorAccountId,'guest1');
assert.equal(created.job.ownerAccountId,'owner1');
assert.equal(created.job.grantId,'grant1');
assert.equal(created.job.permissionRevision,7);
assert.deepEqual(created.job.requiredCapabilities,['filesystem']);
assert.match(created.job.jobId,/^[a-f0-9-]{36}$/);
assert.match(created.job.operationId,/^guestop_[a-f0-9-]{36}$/);
const retry=await clone.enqueue(base);
assert.equal(retry.reused,true);
assert.equal(retry.job.operationId,created.job.operationId);
await assert.rejects(queue.enqueue({...base,requiredCapabilities:['filesystem','shell']}),
 /guest_queue_request_replay_conflict/);
assert.equal(rows.size,1);
const loaded=await queue.loadTrustedJob(created.job.jobId);
assert.equal(loaded.jobId,created.job.jobId);
assert.equal(loaded.clientSessionId,'lrc_guest_1');
bindingsRevoked=true;
assert.equal(await queue.loadTrustedJob(created.job.jobId),null,
 'revoked native binding must hide stale queued job');
bindingsRevoked=false;
wrongGrant=true;
assert.equal(await queue.loadTrustedJob(created.job.jobId),null);
wrongGrant=false;
grantPurpose='device';
await assert.rejects(queue.enqueue({...base,requestKey:'b'.repeat(32)}),
 /guest_queue_independent_agent_binding_required/);
grantPurpose='pro-share-guest';
seatRevision++;
const gate=createGoldProShareDispatchGate({
 env:{LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_DISPATCH:'1',
 LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE:'1',
 LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL:'1',
 LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE:'1'},
 store:{authorizeOperation:async()=>({
 actorAccountId:'guest1',agentId:agent,deviceId:'device1',grantId:'grant1',
 connectionId:'connection1',billedAccountId:'owner1',
 permissionRevision:seatRevision,accessExpiresAt:time+50000,
 maxGuestConcurrentJobs:1}),billOnce:async()=>{throw Error('not dispatched')}},
 accessGrants:{assert(){}},
 loadTrustedJob:id=>queue.loadTrustedJob(id),
 loadTrustedIntent:async()=>null,
 reserveOwnerM4:async()=>{throw Error('source only')},
 cancelOwnerM4:async()=>({cancelled:true}),
 loadFreshContext:async()=>context(),
 acquireGuestSlot:async()=>{slotsCreated++;throw Error('slot must not be acquired')},
 dispatchEffect:async()=>{throw Error('no live dispatch')},now:()=>time
});
await assert.rejects(gate.admit({jobId:created.job.jobId}),/pro_share_authority_mismatch/);
assert.equal(slotsCreated,0);
seatRevision--;
currentConnection='connection2';
assert.equal(await queue.loadTrustedJob(created.job.jobId),null,
 'rotated owner connection invalidates Guest binding');
currentConnection='connection1';
verifiedFree=false;
assert.equal(await queue.loadTrustedJob(created.job.jobId),null);
verifiedFree=true;
active=false;
assert.equal(await queue.loadTrustedJob(created.job.jobId),null);
active=true;
await assert.rejects(queue.cancelQueued({jobId:created.job.jobId,
 opaqueOAuthContext:otherToken}),/guest_queue_verified_oauth_required/);
assert.equal((await queue.cancelQueued({jobId:created.job.jobId,
 opaqueOAuthContext:oauthToken})).cancelled,true);
assert.equal((await queue.loadTrustedJob(created.job.jobId)).state,'cancelled');
assert.equal(queryLog.filter(x=>x.q.startsWith('INSERT INTO lr_gold_pro_share_guest_jobs')).length,1);
console.log('GOLD_P2I4C3B_QUEUE_VERIFIED_OAUTH_AGENT_BINDING_PG_IDEMPOTENCY=PASS');
console.log('GOLD_P2I4C3B_REVOCATION_ROTATION_REVISION_REPLAY_CANCEL=PASS');
console.log('GOLD_P2I4C3B_NO_GUEST_DISPATCH_FROM_STALE_QUEUE=PASS');
