import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopV4OwnerInventoryPage} from './desktop-v4-owner-inventory-page.mjs';

const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const OWNER='owner',FOREIGN='other';
function fixture(count=240,grantCount=227){
  const state={valid:true,ownerRevision:4,now:Date.UTC(2026,10,7),lookups:[],mutate:()=>{}};
  const devices=Array.from({length:count},(_,i)=>({
    accountId:OWNER,deviceId:'dev-'+String(i).padStart(5,'0'),
    displayName:'Machine '+i,platform:i%2?'windows':'linux',state:'online',lastSeenAt:state.now,
    privateSecret:'NEVER_EXPOSE'
  }));
  devices.push({accountId:FOREIGN,deviceId:'dev-foreign',displayName:'FOREIGN',state:'online'});
  const grants=Array.from({length:grantCount},(_,i)=>({
    accountId:OWNER,deviceId:'dev-'+String(i%count).padStart(5,'0'),
    grantId:'grant-'+String(i).padStart(6,'0'),agentId:'agent-'+i,purpose:'device',
    approvedAt:state.now-500,expiresAt:state.now+60000,absoluteExpiresAt:state.now+90000,
    privateToken:'SECRET_NEVER'
  }));
  grants.push({accountId:FOREIGN,deviceId:'dev-00000',grantId:'grant-foreign',
    purpose:'device',approvedAt:state.now-500,expiresAt:state.now+60000,
    absoluteExpiresAt:state.now+90000});
  grants.push({accountId:OWNER,deviceId:'dev-00000',grantId:'grant-guest',purpose:'team-member',
    approvedAt:state.now-500,expiresAt:state.now+60000,absoluteExpiresAt:state.now+90000});
  const accounts={
    get ownerRevision(){return state.ownerRevision;},
    desktopOwnerSessionActive:(aid,sid)=>state.valid&&aid===OWNER&&sid===SESSION,
    account:aid=>({accountId:aid,isOwner:aid===OWNER,emailVerified:true,status:'active'})
  };
  const api=createDesktopV4OwnerInventoryPage({
    accounts,allDeviceViews:({accountId}={})=>devices.filter(d=>!accountId||d.accountId===accountId),
    accessGrants:{activeGrantsForDevices:deviceIds=>{
      const ids=new Set(deviceIds),m=new Map();
      for(const row of grants)if(ids.has(row.deviceId)&&!row.closedAt&&!row.activationPending&&
        row.expiresAt>state.now&&row.absoluteExpiresAt>state.now){
        if(!m.has(row.deviceId))m.set(row.deviceId,[]);
        m.get(row.deviceId).push(row);
      }
      return m;
    }},
    lookupShortIds:async ({accountId,deviceIds})=>{
      assert.equal(accountId,OWNER);
      assert.ok(deviceIds.every(id=>id!=='dev-foreign'));
      state.lookups.push([...deviceIds]);
      state.mutate();
      return new Map(deviceIds.map(id=>[id,'R01KAP']));
    },
    now:()=>state.now
  });
  const read=(kind,cursor=null,limit=100,accountId=OWNER,accountSessionId=SESSION)=>
    api({accountId,accountSessionId,page:{kind,cursor,limit}});
  return {state,devices,grants,read};
}
test('owner-scoped device pages 100/100/40, Short ID for page ONLY',async()=>{
  const f=fixture();
  const a=await f.read('devices');
  assert.equal(a.kind,'devices');assert.equal(a.rows.length,100);
  assert.equal(a.coverage.total,240);assert.equal(a.coverage.hasMore,true);
  assert.equal(a.rows[0].deviceId,'dev-00000');
  assert.equal(f.state.lookups[0].length,100);
  const b=await f.read('devices',a.coverage.nextCursor);
  assert.equal(b.rows.length,100);
  assert.equal(f.state.lookups[1].length,100);
  const c=await f.read('devices',b.coverage.nextCursor);
  assert.equal(c.rows.length,40);
  assert.equal(c.coverage.hasMore,false);
  assert.equal(c.coverage.nextCursor,null);
  assert.equal(f.state.lookups[2].length,40);
  assert.equal(new Set([...a.rows,...b.rows,...c.rows].map(r=>r.deviceId)).size,240);
  assert.ok(!JSON.stringify([a,b,c]).includes('NEVER_EXPOSE'));
  assert.ok(!JSON.stringify([a,b,c]).includes('dev-foreign'));
});
test('grant pages 100/100/27 retain same Owner and device scope without guest',async()=>{
  const f=fixture();
  const first=await f.read('grants');
  const second=await f.read('grants',first.coverage.nextCursor);
  const third=await f.read('grants',second.coverage.nextCursor);
  assert.deepEqual([first.rows.length,second.rows.length,third.rows.length],[100,100,27]);
  assert.equal(first.coverage.total,227);
  assert.equal(third.coverage.nextCursor,null);
  const all=[...first.rows,...second.rows,...third.rows];
  assert.equal(new Set(all.map(g=>g.grantId)).size,227);
  assert.ok(!JSON.stringify(all).includes('SECRET_NEVER'));
  assert.ok(!JSON.stringify(all).includes('grant-guest'));
  assert.ok(!JSON.stringify(all).includes('grant-foreign'));
  assert.equal(f.state.lookups.length,0,'grants never ask PG043 Short IDs');
});
test('foreign Owner, invalid cursor/limit/kind and cross-kind page are rejected',async()=>{
  const f=fixture();
  const a=await f.read('devices');
  await assert.rejects(f.read('devices',a.coverage.nextCursor,100,FOREIGN),/owner_required/);
  await assert.rejects(f.read('grants',a.coverage.nextCursor),/cursor_scope_mismatch/);
  await assert.rejects(f.read('devices',a.coverage.nextCursor,50),/cursor_scope_mismatch/);
  await assert.rejects(f.read('devices','malformed!'),/cursor_invalid/);
  const tampered=a.coverage.nextCursor.slice(0,-1)+'x';
  await assert.rejects(f.read('devices',tampered),/cursor_invalid|cursor_stale/);
  for(const invalid of [0,-1,101,1.5,'100'])
    await assert.rejects(f.read('devices',null,invalid),/limit_invalid/);
  await assert.rejects(f.read('other'),/kind_invalid/);
});
test('stale grant membership, device revocation and Owner signout fail closed',async()=>{
  const f=fixture();
  const a=await f.read('grants');
  f.grants[0].closedAt=f.state.now;
  await assert.rejects(f.read('grants',a.coverage.nextCursor),/cursor_stale/);
  const d=await f.read('devices');
  f.devices[0].state='revoked';f.devices[0].revokedAt=f.state.now;
  await assert.rejects(f.read('devices',d.coverage.nextCursor),/cursor_stale/);
  f.state.valid=false;
  await assert.rejects(f.read('devices'),/owner_required/);
});
test('post-await Owner revocation rejects rather than returning populated page',async()=>{
  const f=fixture();
  f.state.mutate=()=>{f.state.valid=false;};
  await assert.rejects(f.read('devices'),/owner_revoked_during_read/);
});
test('10k synthetic devices page remains bounded and uses only 100 Short ID lookups',async()=>{
  const f=fixture(10000,10000);
  const page=await f.read('devices');
  assert.equal(page.rows.length,100);
  assert.equal(page.coverage.total,10000);
  assert.equal(f.state.lookups.length,1);
  assert.equal(f.state.lookups[0].length,100);
});

test('device Owner relink or revocation while PG043 is awaited rejects stale page',async()=>{
  const f=fixture();
  f.state.mutate=()=>{f.devices[0].accountId=FOREIGN;};
  await assert.rejects(f.read('devices'),/membership_changed_during_read/);
  const g=fixture();
  g.state.mutate=()=>{g.devices[0].state='revoked';g.devices[0].revokedAt=g.state.now;};
  await assert.rejects(g.read('devices'),/membership_changed_during_read/);
});
