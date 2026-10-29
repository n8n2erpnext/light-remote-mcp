/*
 * Light Remote Gold G3 direct peer transport (device-to-device, no server relay).
 * Pull-only from a Home device; only E2EE frames travel on the wire.
 * Peer requests are Ed25519 signed, nonce-replay-guarded and scope-grant-bound.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import {isIP} from 'node:net';
import {prepareGoldMemorySync,goldNextSyncFrame,goldApplySyncAck,goldApplySyncFrame} from './gold-memory-sync.mjs';
import {requireGoldMemoryPrivateKey} from './gold-memory-key-permissions.mjs';

const PROTOCOL='light-remote-memory-peer-v1';
const MAX_AGE=120000;
const NONCE_EXPIRE=600000;
const MAX_DATA=60000;
const validScope=/^[0-9a-f-]{36}$/i;
function fail(code,status=403){return Object.assign(new Error(code),{status});}
function checkedPrivate(file){
  requireGoldMemoryPrivateKey(file,'gold_peer_signing_key_permissions');
  const key=crypto.createPrivateKey(fs.readFileSync(file));
  if(key.asymmetricKeyType!=='ed25519')throw fail('gold_peer_signing_key_type_invalid');
  return key;
}
function verify(pub,content,signature){
  if(typeof signature!=='string'||signature.length>256)return false;
  const key=crypto.createPublicKey({key:Buffer.from(pub,'base64'),format:'der',type:'spki'});
  return key.asymmetricKeyType==='ed25519'&&crypto.verify(null,
    Buffer.from(JSON.stringify(content)),key,Buffer.from(signature,'base64'));
}
export function signGoldPeerRequest(signFile,{accountId,deviceId,homeDeviceId,scopeId,action,receipt,
  now=Date.now(),nonce=crypto.randomBytes(18).toString('hex')}={}){
  if(!['pull','ack'].includes(action)||!validScope.test(scopeId))throw fail('gold_peer_request_invalid',400);
  const payload={protocol:PROTOCOL,accountId,deviceId,homeDeviceId,scopeId,action,now,nonce};
  if(action==='ack'){
    if(!receipt||typeof receipt!=='object')throw fail('gold_peer_ack_required',400);
    payload.receipt=receipt;
  }
  const signature=crypto.sign(null,Buffer.from(JSON.stringify(payload)),checkedPrivate(signFile)).toString('base64');
  return {payload,signature};
}
function signedGoldPeerResponse(signFile,request,result){
  const req=request.payload;
  const payload={protocol:PROTOCOL,accountId:req.accountId,homeDeviceId:req.homeDeviceId,
    deviceId:req.deviceId,scopeId:req.scopeId,action:req.action,
    requestNonce:req.nonce,result};
  const signature=crypto.sign(null,Buffer.from(JSON.stringify(payload)),
    checkedPrivate(signFile)).toString('base64');
  return {payload,signature};
}
export function verifyGoldPeerResponse(homePublicKey,request,response){
  const req=request?.payload, p=response?.payload;
  if(!req||!p||p.protocol!==PROTOCOL||p.accountId!==req.accountId||
    p.homeDeviceId!==req.homeDeviceId||p.deviceId!==req.deviceId||
    p.scopeId!==req.scopeId||p.action!==req.action||
    p.requestNonce!==req.nonce||!p.result||
    !verify(homePublicKey,p,response.signature))
    throw fail('gold_peer_home_response_signature_invalid',403);
  return p.result;
}
export function receiveGoldPeerRequest(db,signFile,encFile,{accountId,deviceId,request,now=Date.now()}={}){
  if(!request||JSON.stringify(request).length>MAX_DATA)throw fail('gold_peer_request_oversize',413);
  const p=request.payload;
  if(!p||p.protocol!==PROTOCOL||p.accountId!==accountId||p.homeDeviceId!==deviceId||
    !validScope.test(String(p.scopeId||''))||!['pull','ack'].includes(p.action)||
    typeof p.deviceId!=='string'||p.deviceId===deviceId||!Number.isSafeInteger(p.now)||
    !Number.isSafeInteger(now)||Math.abs(now-p.now)>MAX_AGE||
    typeof p.nonce!=='string'||!/^[a-f0-9]{36}$/.test(p.nonce))
    throw fail('gold_peer_request_invalid');
  prepareGoldMemorySync(db);
  const scope=db.prepare(`SELECT home_device_id,sync_policy,status FROM lm_scopes
    WHERE account_id=? AND scope_id=?`).get(accountId,p.scopeId);
  if(!scope||scope.status!=='active'||scope.home_device_id!==deviceId||
    scope.sync_policy==='local_only')throw fail('gold_peer_scope_not_shareable');
  const member=db.prepare(`SELECT sign_public_key FROM lm_scope_members
    WHERE scope_id=? AND device_id=? AND role='replica' AND revoked_at IS NULL`)
    .get(p.scopeId,p.deviceId);
  if(!member||!verify(member.sign_public_key,p,request.signature))
    throw fail('gold_peer_signature_invalid');
  db.exec(`CREATE TABLE IF NOT EXISTS lm_peer_seen_nonce(
    scope_id TEXT NOT NULL,device_id TEXT NOT NULL,nonce TEXT NOT NULL,seen_at INTEGER NOT NULL,
    PRIMARY KEY(scope_id,device_id,nonce))`);
  db.prepare('DELETE FROM lm_peer_seen_nonce WHERE seen_at<?').run(now-NONCE_EXPIRE);
  if(!db.prepare(`INSERT OR IGNORE INTO lm_peer_seen_nonce(scope_id,device_id,nonce,seen_at)
    VALUES(?,?,?,?)`).run(p.scopeId,p.deviceId,p.nonce,now).changes)
    throw fail('gold_peer_replayed_request');
  if(p.action==='pull'){
    const next=goldNextSyncFrame(db,signFile,encFile,{
      accountId,deviceId,scopeId:p.scopeId,replicaDeviceId:p.deviceId});
    const result=next.state==='up_to_date'?{state:'up_to_date',revision:next.revision}:
      {state:'frame',frame:next.frame};
    return signedGoldPeerResponse(signFile,request,result);
  }
  if(!p.receipt||p.receipt.deviceId!==p.deviceId||p.receipt.scopeId!==p.scopeId)
    throw fail('gold_peer_ack_mismatch');
  return signedGoldPeerResponse(signFile,request,{
    state:'ack',result:goldApplySyncAck(db,{accountId,deviceId,receipt:p.receipt})});
}
export function allowGoldPeerHomeUrl(input){
  // Only RFC6598 NetBird peer IPs may be used. NO DNS, localhost, redirects or public endpoints.
  let parsed;try{parsed=new URL(input);}catch{throw fail('gold_peer_home_url_invalid',400);}
  if(parsed.protocol!=='http:'||parsed.username||parsed.password||parsed.search||parsed.hash||
    parsed.pathname!=='/'||isIP(parsed.hostname)!==4)throw fail('gold_peer_home_url_invalid',400);
  const oct=parsed.hostname.split('.').map(Number);
  if(oct[0]!==100||oct[1]<64||oct[1]>127||
    !Number.isInteger(Number(parsed.port))||Number(parsed.port)<1024||Number(parsed.port)>65535)
    throw fail('gold_peer_netbird_only',400);
  return parsed.origin;
}
export async function pollGoldPeer(db,signFile,encFile,{accountId,deviceId,scopeId,homeDeviceId,
  homeUrl,fetchImpl=fetch,timeoutMs=7500}={}){
  const origin=allowGoldPeerHomeUrl(homeUrl);
  if(!validScope.test(scopeId)||typeof homeDeviceId!=='string'||homeDeviceId===deviceId)
    throw fail('gold_peer_poll_target_invalid',400);
  prepareGoldMemorySync(db);
  const scope=db.prepare('SELECT * FROM lm_scopes WHERE scope_id=? AND account_id=?')
    .get(scopeId,accountId);
  const member=db.prepare(`SELECT grant_id FROM lm_scope_members
    WHERE scope_id=? AND device_id=? AND role='home' AND revoked_at IS NULL`)
    .get(scopeId,homeDeviceId);
  if(!scope||!member||scope.home_device_id!==homeDeviceId||
    scope.home_device_id===deviceId)throw fail('gold_peer_not_authorized');
  async function send(action,receipt){
    const request=signGoldPeerRequest(signFile,{accountId,deviceId,homeDeviceId,scopeId,action,receipt});
    const response=await fetchImpl(origin+'/api/gold/peer/v1',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(request),signal:AbortSignal.timeout(Math.max(1000,Math.min(timeoutMs,15000))),
      redirect:'error'
    });
    if(!response.ok)throw fail('gold_peer_remote_'+response.status,response.status);
    const length=Number(response.headers.get('content-length')||0);
    if(length>MAX_DATA)throw fail('gold_peer_response_oversize',413);
    const raw=await response.text();
    if(raw.length>MAX_DATA)throw fail('gold_peer_response_oversize',413);
    const parsed=JSON.parse(raw);
    if(!parsed.ok||!parsed.result)throw fail('gold_peer_response_invalid',409);
    return verifyGoldPeerResponse(scope.home_public_key,request,parsed.result);
  }
  const pulled=await send('pull');
  if(pulled.state==='up_to_date')return {state:'up_to_date',remoteRevision:pulled.revision};
  if(pulled.state!=='frame'||!pulled.frame)throw fail('gold_peer_response_invalid',409);
  const saved=goldApplySyncFrame(db,signFile,encFile,{accountId,deviceId,frame:pulled.frame});
  const acked=await send('ack',saved.ack);
  if(acked.state!=='ack'||!['acked','duplicate'].includes(acked.result?.status))
    throw fail('gold_peer_ack_rejected',409);
  return {state:saved.status,revision:saved.revision,
    checkpointId:pulled.frame.meta.checkpointId,ack:acked.result.status};
}

const configured=new WeakSet();
export function prepareGoldPeerRoutes(db){
  if(configured.has(db))return;
  prepareGoldMemorySync(db);
  db.exec(`CREATE TABLE IF NOT EXISTS lm_peer_routes(
    scope_id TEXT PRIMARY KEY REFERENCES lm_scopes(scope_id),
    home_url TEXT NOT NULL,home_device_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    last_success_at INTEGER NULL,last_error_code TEXT NULL,updated_at INTEGER NOT NULL
  )`);
  configured.add(db);
}
export function configureGoldPeerRoute(db,{accountId,deviceId,scopeId,homeUrl,enabled=false}={}){
  prepareGoldPeerRoutes(db);
  if(typeof enabled!=='boolean'||!validScope.test(scopeId))throw fail('gold_peer_route_invalid',400);
  const url=allowGoldPeerHomeUrl(homeUrl);
  const scope=db.prepare('SELECT home_device_id,status FROM lm_scopes WHERE account_id=? AND scope_id=?')
    .get(accountId,scopeId);
  const grant=scope&&db.prepare(`SELECT grant_id FROM lm_scope_members WHERE scope_id=? AND device_id=?
    AND role='home' AND revoked_at IS NULL`).get(scopeId,scope.home_device_id);
  if(!scope||!grant||scope.home_device_id===deviceId||scope.status!=='active')
    throw fail('gold_peer_route_scope_not_authorized',403);
  db.prepare(`INSERT INTO lm_peer_routes(scope_id,home_url,home_device_id,enabled,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(scope_id) DO UPDATE SET
    home_url=excluded.home_url,home_device_id=excluded.home_device_id,
    enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .run(scopeId,url,scope.home_device_id,Number(enabled),Date.now());
  return {scopeId,homeDeviceId:scope.home_device_id,homeUrl:url,enabled};
}
export function listGoldPeerRoutes(db,{accountId}={}){
  prepareGoldPeerRoutes(db);
  return db.prepare(`SELECT r.scope_id AS scopeId,r.home_url AS homeUrl,
    r.home_device_id AS homeDeviceId,r.enabled,r.last_success_at AS lastSuccessAt,
    r.last_error_code AS lastErrorCode
    FROM lm_peer_routes r JOIN lm_scopes s ON s.scope_id=r.scope_id
    WHERE s.account_id=? ORDER BY r.updated_at DESC LIMIT 40`).all(accountId)
    .map(x=>({...x,enabled:x.enabled===1}));
}
export async function runGoldPeerRoutes(db,signFile,encFile,{accountId,deviceId,maxPerTick=2}={}){
  prepareGoldPeerRoutes(db);
  if(!Number.isInteger(maxPerTick)||maxPerTick<1||maxPerTick>4)
    throw fail('gold_peer_tick_invalid',400);
  const routes=db.prepare(`SELECT r.scope_id AS scopeId,r.home_url AS homeUrl,
    r.home_device_id AS homeDeviceId FROM lm_peer_routes r
    JOIN lm_scopes s ON s.scope_id=r.scope_id WHERE s.account_id=?
    AND r.enabled=1 AND s.status='active' ORDER BY r.updated_at LIMIT ?`)
    .all(accountId,maxPerTick);
  const results=[];
  for(const route of routes){
    try{
      const outcome=await pollGoldPeer(db,signFile,encFile,{accountId,deviceId,
        ...route,scopeId:route.scopeId});
      db.prepare(`UPDATE lm_peer_routes SET last_success_at=?,last_error_code=NULL
        WHERE scope_id=?`).run(Date.now(),route.scopeId);
      results.push({scopeId:route.scopeId,state:outcome.state,revision:outcome.revision??outcome.remoteRevision});
    }catch(error){
      const code=String(error.message||'gold_peer_unavailable').slice(0,90);
      db.prepare('UPDATE lm_peer_routes SET last_error_code=? WHERE scope_id=?')
        .run(code,route.scopeId);
      results.push({scopeId:route.scopeId,state:'error',error:code});
    }
  }
  return results;
}
