import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from './executor-routes-device-channel.mjs';
import {DevicePairingRegistryError} from './device-pairing-registry.mjs';
import {startLocalWall} from '../device-agent/local-wall.mjs';

async function withPolicy(enabled,fn){
 const previousId=process.env.LR_GOLD_INSTANCE_ID;
 const previousLock=process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1;
 process.env.LR_GOLD_INSTANCE_ID=enabled?'abv2lab01':'other';
 process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=enabled?'1':'0';
 try{return await fn();}
 finally{
  if(previousId===undefined)delete process.env.LR_GOLD_INSTANCE_ID;
  else process.env.LR_GOLD_INSTANCE_ID=previousId;
  if(previousLock===undefined)delete process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1;
  else process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1=previousLock;
 }
}

test('Operator denies all legacy V1 pairing mint/redeem/poll/attach before parsing input',async()=>{
 await withPolicy(true,async()=>{
  let parsed=0;
  for(const route of [
   '/v1/device-pair/begin','/v1/device-access/request',
   '/v1/device-access/poll','/v1/device-access/recover',
   '/v1/device-access/recover-consume',
   '/v1/device-channel/pairing-code','/v1/device-channel/access-approve'
  ]){
   const req={method:'POST'};
   await assert.rejects(
    handleDeviceChannelRoutes(req,{},new URL('http://localhost'+route),{
     DevicePairingRegistryError,
     readJson:()=>{parsed++;throw Error('must_not_read_legacy_body');}
    }),
    error=>error instanceof DevicePairingRegistryError&&
      error.status===423&&error.message==='abv2_server_legacy_v1_disabled',
    'Server must deny legacy: '+route
   );
  }
  assert.equal(parsed,0,'Legacy routes must fail closed before body read');
 });
});

test('signed Operator status announces server V2 policy rather than a client flag',async()=>{
 const params={
  DevicePairingRegistryError,
  readJson:async()=>({}),
  verifiedChannelContext:async()=>({
   binding:{accountId:'owner',deviceId:'device-a'},
   device:{deviceId:'device-a'}
  }),
  requireDeviceConnection:()=>({connectionId:'connection-a'}),
  sessions:{list:()=>[]},
  accessGrants:{activeForDevice:()=>null,activeGrantsForDevice:()=>[],pendingForDevice:()=>[]},
  connections:{get:()=>({connectionId:'connection-a'})},
  deviceView:()=>({deviceId:'device-a'}),
  accounts:{account:()=>({mainDeviceId:'device-a'})},
  goldShortIdByDevice:async({deviceId,accountId})=>{
   assert.equal(deviceId,'device-a');
   assert.equal(accountId,'owner');
   return 'R01KAP';
  },
  sendJson:(_res,status,value)=>({status,...value})
 };
 const route=new URL('http://localhost/v1/device-channel/status');
 const req={method:'POST'};
 const locked=await withPolicy(true,()=>handleDeviceChannelRoutes(req,{},route,params));
 assert.equal(locked.status,200);
 assert.equal(locked.pairingMode,'abv2_only');
 assert.equal(locked.shortId,'R01KAP');
 assert.equal(locked.isMain,true);
 const legacy=await withPolicy(false,()=>handleDeviceChannelRoutes(req,{},route,params));
 assert.equal(legacy.pairingMode,'legacy_allowed');
});

test('Wall hides V1 until signed Operator explicitly authorizes legacy pairing',async()=>{
 await withPolicy(false,async()=>{
  const wall=startLocalWall({host:'127.0.0.1',port:0,auth:{enabled:false}});
  try{
   if(!wall.server.listening)await new Promise((resolve,reject)=>
    wall.server.once('listening',resolve).once('error',reject));
   const html=await (await fetch('http://127.0.0.1:'+wall.server.address().port+'/')).text();
   assert.match(html,/class="paircontrol" style="display:none"/);
   assert.match(html,/let serverPairingMode='unknown'/);
   assert.match(html,/remoteState\?\.pairingMode==='abv2_only'/);
   assert.match(html,/remoteState\?\.shortId/);
   assert.match(html,/if\(short&&shortId\)short\.textContent=shortId/);
   assert.match(html,/serverPairingMode==='legacy_allowed'&&v2===false/);
   assert.match(html,/serverPairingMode!=='legacy_allowed'\|\|abV2ModeLatched/);
  }finally{await new Promise(resolve=>wall.server.close(resolve));}
 });
});
