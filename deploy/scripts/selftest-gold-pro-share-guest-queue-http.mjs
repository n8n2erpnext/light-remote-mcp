import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {goldAbV2HelperKey} from '../../lib/gold-ab-v2-helper-proof.mjs';
import {signGoldGuestQueueProof,verifyGoldGuestQueueProof}
 from '../../lib/gold-pro-share-guest-queue-proof.mjs';
import {createGoldProShareGuestQueueHttp}
 from '../../operator-host/pro-share-guest-queue-http.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-guest-queue-oauth-'));
try{
 const keyFile=path.join(root,'key');fs.writeFileSync(keyFile,crypto.randomBytes(32),{mode:0o600});
 const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_HELPER_PROOF_KEY_FILE:keyFile,
  LR_GOLD_AB_V2_SEAL_KEY_FILE:keyFile,
  LR_GOLD_AB_V2_OWNER_ORIGIN:'https://example.test',
  LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',
  LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:'owner1',
  LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:'device1',
  LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_GUEST_AB_POLL:'1',
  LR_GOLD_PRO_SHARE_GUEST_BIND:'1',
  LR_GOLD_PRO_SHARE_GUEST_QUEUE:'1',LR_GOLD_PRO_SHARE_GUEST_SLOTS:'1',
  LR_GOLD_PRO_SHARE_GUEST_SIGNED_LAUNCH:'1',
  LR_GOLD_PRO_SHARE_GUEST_QUEUE_HTTP:'1'};
 const identity={accountId:'guest1',clientId:'oauth-client-'+'x'.repeat(80)};
 const key=goldAbV2HelperKey(env),now=1850000000000;
 const replay=new Set();
 const redis={async set(k,v,args){
  assert.equal(args.NX,true);if(replay.has(k))return null;
  replay.add(k);return 'OK';
 }};
 const proof=()=>signGoldGuestQueueProof({identity,deviceId:'device1',
  requestKey:'f'.repeat(32),operation:'exec',
  requiredCapabilities:['filesystem'],key,now});
 const verified=await verifyGoldGuestQueueProof({proof:proof(),key,redis,
  prefix:'lr:gold:fixture:',now});
 assert.equal(verified.accountId,'guest1');
 assert.equal(verified.verified,true);
 const p=proof();
 await verifyGoldGuestQueueProof({proof:p,key,redis,prefix:'lr:gold:fixture:',now});
 await assert.rejects(verifyGoldGuestQueueProof({proof:p,key,redis,
  prefix:'lr:gold:fixture:',now}),/guest_queue_proof_replayed/);
 await assert.rejects(verifyGoldGuestQueueProof({proof:{...proof(),
  ownerAccountId:'owner1'},key,redis,prefix:'lr:gold:fixture:',now}),
  /guest_queue_proof_fields_invalid/);
 await assert.rejects(verifyGoldGuestQueueProof({proof:{...proof(),
  accountId:'owner1'},key,redis,prefix:'lr:gold:fixture:',now}),
  /guest_queue_proof_invalid|guest_queue_signature_invalid/);
 let calls=0;
 const pool={connect:async()=>({query:async()=>({rows:[]}),release(){}})};
 const deps={env,storage:{pool,redis,prefix:'lr:gold:fixture:'},
  accounts:{assertOperational:id=>({accountId:id,plan:id==='guest1'?'free':'pro',
   emailVerified:true})},
  devices:{get:()=>({deviceId:'device1',accountId:'owner1',nodeId:'node1',
   publicIdentityKey:'pub',state:'online',capabilities:['filesystem']})},
  connections:{assertConnected:()=>({deviceId:'device1',accountId:'owner1',
   connectionId:'conn1',state:'connected',hardExpiresAt:now+50000})},
  enrollments:{
   binding:()=>({deviceId:'device1',accountId:'owner1',
    publicIdentityKey:'pub',revokedAt:null}),
   policyView:()=>({accountId:'owner1',policyProfile:'default',policyRevision:7,
    approvedCapabilities:['filesystem']})},
  accessGrants:{assert(){}},agentClients:{findActive(){}},
  store:{authorizeOperation(){}},readJson:async req=>req.data,
  sendJson:(res,status,body)=>{res.status=status;res.body=body},
  now:()=>now,
  createQueue:({authenticateOAuth,loadFreshContext})=>({
   async enqueue({opaqueOAuthContext,deviceId,requestKey,operation,
    requiredCapabilities}){
    calls++;
    assert.equal(await authenticateOAuth({accountId:'guest1'}),null);
    const actor=await authenticateOAuth(opaqueOAuthContext);
    assert.equal(actor.verified,true);
    assert.equal(actor.accountId,'guest1');
    assert.equal(actor.clientId,identity.clientId);
    assert.equal(deviceId,'device1');assert.equal(requestKey,'f'.repeat(32));
    assert.equal(operation,'exec');
    assert.deepEqual(requiredCapabilities,['filesystem']);
    const route=await loadFreshContext(deviceId);
    assert.equal(route.device.accountId,'owner1');
    assert.deepEqual(route.routeCapabilities,['filesystem']);
    return {job:{jobId:'queue-job-'+calls,actorAccountId:'guest1',
     deviceId:'device1'},reused:false};
   }
  })
 };
 const uri=new URL('http://localhost/v1/plugin/pro-share/guest-queue/enqueue');
 const call=async(handler,data)=>{const res={};await handler({
  method:'POST',data},res,uri);return res};
 const off=createGoldProShareGuestQueueHttp({...deps,env:{...env,
  LR_GOLD_PRO_SHARE_GUEST_QUEUE_HTTP:'0'}});
 assert.equal((await call(off,proof())).status,404);
 assert.throws(()=>createGoldProShareGuestQueueHttp({...deps,
  env:{...env,LR_GOLD_PRO_SHARE_GUEST_BIND:'0'}}),/dependencies_flags_off/);
 const http=createGoldProShareGuestQueueHttp(deps);
 const invalid=await call(http,{...proof(),guestAccountId:'guest2'});
 assert.equal(invalid.status,401);
 const forged=await call(http,{...proof(),deviceId:'device2'});
 assert.equal(forged.status,401);
 const good=await call(http,proof());
 assert.equal(good.status,200);
 assert.equal(good.body.status,'guest_queue_dispatch_hold');
 assert.equal(good.body.helperReady,false);
 assert.equal(good.body.jobId,'queue-job-1');
 assert.equal(calls,1);
 console.log('GOLD_P2I4C3B2_SIGNED_GUEST_OAUTH_QUEUE_PRODUCER_REPLAY_SPOOF=PASS');
 console.log('GOLD_P2I4C3B2_GUEST_QUEUE_NO_COMMAND_NO_READY_DEFAULT_OFF=PASS');
}finally{fs.rmSync(root,{recursive:true,force:true})}
