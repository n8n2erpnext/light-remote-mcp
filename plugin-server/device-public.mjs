import crypto from 'node:crypto';
import express from 'express';
import { callOperatorJson, proxyOperatorDuplex } from './operator-client.mjs';

const BOOTSTRAP = new Set(['enrollment-begin','enrollment-poll','device-heartbeat']);
const CHANNEL = new Set([
  'connect','disconnect','grace','account-auth',
  'fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity','fleet-device-policy','fleet-device-update',
  'pairing-code','account-owner-proof','access-approve','access-deny','status','session-close','desktop-live-push','activity','update-report','poll','result'
]);
const buckets=new Map();
function ip(req){return String(req.ip||req.socket?.remoteAddress||'unknown').replace(/^::ffff:/,'');}
function hash(v){return crypto.createHash('sha256').update(String(v||'')).digest('hex');}
function allow(key,limit,windowMs=60_000){
  const now=Date.now(),prior=buckets.get(key)||[],rows=prior.filter(t=>now-t<windowMs);
  if(rows.length>=limit){buckets.set(key,rows);return false;}
  rows.push(now);buckets.set(key,rows);return true;
}
export function prunePublicRateState(){const now=Date.now();for(const [k,v] of buckets){const rows=v.filter(t=>now-t<10*60_000);if(rows.length)buckets.set(k,rows);else buckets.delete(k);}}
export function registerPublicDeviceRoutes(app){
  const json=express.json({limit:'12mb'});
  app.post('/api/operator',json,async(req,res)=>{
    const action=String(req.query.action||req.body?.action||'');
    if(!BOOTSTRAP.has(action)) return res.status(403).json({ok:false,error:'public_operator_action_denied'});
    const p=req.body?.payload && typeof req.body.payload==='object'?req.body.payload:req.body||{};
    const seed=action==='enrollment-begin'?p.publicIdentityKey:action==='enrollment-poll'?p.enrollmentId:p.deviceId;
    if(!allow(`bootstrap:${action}:${hash(seed).slice(0,24)}`,action==='device-heartbeat'?180:30)) return res.status(429).json({ok:false,error:'rate_limited'});
    try{
      if(action==='enrollment-begin'){
        const sourceHash=hash(ip(req));
        return res.json(await callOperatorJson('POST','/v1/enrollments/begin',{...p,sourceHash}));
      }
      if(action==='enrollment-poll') return res.json(await callOperatorJson('POST','/v1/enrollments/poll',p));
      if(!p.deviceId) throw new Error('device_id_required');
      return res.json(await callOperatorJson('POST',`/v1/devices/${encodeURIComponent(p.deviceId)}/heartbeat`,p));
    }catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'bootstrap_failed'});}
  });
  app.post('/device-channel/stream',(req,res)=>{
    if(!allow(`duplex:${hash(ip(req)).slice(0,20)}`,2400)) return res.status(429).json({ok:false,error:'rate_limited'});
    return proxyOperatorDuplex(req,res,'/v1/device-channel/stream');
  });
  app.post('/device-channel/:action',json,async(req,res)=>{
    const action=String(req.params.action||'');
    if(!CHANNEL.has(action)) return res.status(404).json({ok:false,error:'device_channel_action_denied'});
    if(!allow(`channel:${action}:${hash(ip(req)).slice(0,20)}`,action==='poll'||action==='result'||action==='desktop-live-push'?600:240)) return res.status(429).json({ok:false,error:'rate_limited'});
    try{return res.json(await callOperatorJson('POST',`/v1/device-channel/${encodeURIComponent(action)}`,req.body||{}));}
    catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'device_channel_failed'});}
  });
}
