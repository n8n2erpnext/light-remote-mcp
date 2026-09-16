import crypto from 'node:crypto';
import express from 'express';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';

const BOOTSTRAP_ACTIONS=new Set(['enrollment-begin','enrollment-poll','device-heartbeat']);
const CHANNEL_ACTIONS=new Set(['connect','disconnect','grace','account-auth','fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity','fleet-device-policy','fleet-device-update','pairing-code','account-owner-proof','access-approve','access-deny','status','activity','update-report','poll','result']);
const buckets=new Map();
const hash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
function allowRate(key,limit,windowMs=60_000){
  const now=Date.now(),cut=now-windowMs,prior=(buckets.get(key)||[]).filter(t=>t>cut);
  if(prior.length>=limit){buckets.set(key,prior);return false;}
  prior.push(now);buckets.set(key,prior);return true;
}
function fail(res,error){const status=Math.max(400,Math.min(Number(error?.status)||502,599));return res.status(status).json({ok:false,error:String(error?.message||'device_bridge_failed').slice(0,160)});}

export function registerPublicDeviceRoutes(app){
  const json=express.json({limit:'256kb',strict:true});
  app.post('/api/operator',json,async(req,res)=>{
    const action=String(req.body?.action||'');
    if(!BOOTSTRAP_ACTIONS.has(action))return res.status(404).json({ok:false,error:'public_operator_action_denied'});
    const p=req.body?.payload&&typeof req.body.payload==='object'?req.body.payload:{};
    const rateSeed=action==='enrollment-begin'?p.publicIdentityKey:action==='enrollment-poll'?p.enrollmentId:p.deviceId;
    const ipHash=hash(req.ip||req.socket.remoteAddress||'unknown').slice(0,24);
    if(!allowRate(`bootstrap:${action}:${hash(rateSeed).slice(0,24)}`,action==='device-heartbeat'?180:30))return res.status(429).json({ok:false,error:'rate_limited'});
    if(action==='enrollment-begin'&&(!allowRate(`bootstrap:enrollment-begin:ip:${ipHash}`,60)||!allowRate('bootstrap:enrollment-begin:global',120)))return res.status(429).json({ok:false,error:'rate_limited'});
    try{
      let upstream;
      if(action==='enrollment-begin'){
        const sourceHash=hash(`public-enrollment:${ipHash}|${String(p.publicIdentityKey||'')}`);
        upstream=await callOperatorJson('POST','/v1/enrollments/begin',{...p,sourceHash});
      }else if(action==='enrollment-poll')upstream=await callOperatorJson('POST','/v1/enrollments/poll',p);
      else{
        if(!p.deviceId)return res.status(400).json({ok:false,error:'device_id_required'});
        upstream=await callOperatorJson('POST',`/v1/devices/${encodeURIComponent(p.deviceId)}/heartbeat`,p);
      }
      return res.json({ok:true,upstream});
    }catch(error){return fail(res,error);}
  });

  app.post('/device-channel/:action',json,async(req,res)=>{
    const action=String(req.params.action||'');
    if(!CHANNEL_ACTIONS.has(action))return res.status(404).json({ok:false,error:'device_channel_action_denied'});
    const deviceId=String(req.body?.deviceId||'').slice(0,160);
    if(!deviceId)return res.status(400).json({ok:false,error:'device_id_required'});
    const limit=action==='poll'?240:action==='result'?240:120;
    if(!allowRate(`channel:${action}:${hash(deviceId).slice(0,24)}`,limit)||!allowRate(`channel:${action}:global`,2400))return res.status(429).json({ok:false,error:'rate_limited'});
    try{return res.json(await callOperatorJson('POST',`/v1/device-channel/${encodeURIComponent(action)}`,req.body||{}));}
    catch(error){return fail(res,error);}
  });
}

export function prunePublicDeviceRateState(){
  const cut=Date.now()-5*60_000;
  for(const [key,rows] of buckets){const live=rows.filter(t=>t>cut);if(live.length)buckets.set(key,live);else buckets.delete(key);}
}
