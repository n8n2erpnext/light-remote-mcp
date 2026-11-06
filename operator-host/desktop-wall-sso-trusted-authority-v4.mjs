/**
 * T04b5: strict cross-process Owner-family Redis validation for Operator.
 *
 * The Desktop Plugin and Operator already use the SAME Gold Redis namespace.
 * Operator may validate existing hashed access/family entries without asking
 * a browser for an accountId, without exporting refresh credentials, and
 * without creating a new public or Unix socket endpoint.
 *
 * SOURCE ONLY. No startup path instantiates or enables this factory yet.
 * T04b4 returns 404 until the host explicitly supplies an authority.
 */
import crypto from 'node:crypto';
import {createDesktopWallSsoV4} from '../plugin-server/desktop-wall-sso-v4.mjs';
import {createDesktopWallSsoDeviceProofV4} from './desktop-wall-sso-device-proof-v4.mjs';
import {DESKTOP_OWNER_RESOURCE,DESKTOP_OWNER_SCOPE}
  from '../plugin-server/desktop-auth-v4-contract.mjs';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const SESSION=/^acctsess_[a-f0-9-]{36}$/;
const PREFIX=/^lr:gold:[a-z0-9_-]+:$/;
const sha=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const invalid=()=>Object.assign(new Error('desktop_wall_owner_authority_invalid'),{
  code:'desktop_wall_owner_authority_invalid'
});
const internal=()=>Object.assign(new Error('desktop_wall_owner_authority_unavailable'),{
  code:'desktop_wall_owner_authority_unavailable'
});

export function createDesktopOwnerRedisProofV4({
  redis,prefix,accounts,clock=Date.now
}={}){
  if(!redis||typeof redis.get!=='function'||!PREFIX.test(String(prefix||''))||
     !accounts||typeof accounts.desktopOwnerSessionActive!=='function'||
     typeof clock!=='function')throw internal();
  const key=(kind,value)=>prefix+'desktop-v4:'+kind+':'+sha(value);

  // Redis holds opaque credential digests, NEVER the raw access/refresh.
  // Strict schema avoids treating arbitrary Redis keys as authority.
  async function read(kind,secret){
    if(!TOKEN.test(String(secret||'')))throw invalid();
    const raw=await redis.get(key(kind,secret));
    if(typeof raw!=='string'||raw.length>4096)throw invalid();
    let record;
    try{record=JSON.parse(raw)}catch{throw invalid()}
    if(!record||typeof record!=='object'||Array.isArray(record))throw invalid();
    return record;
  }

  async function activeFamily(accountId,familyId,accountSessionId){
    if(!ACCOUNT.test(String(accountId||''))||
       !TOKEN.test(String(familyId||''))||
       !SESSION.test(String(accountSessionId||'')))throw invalid();
    const family=await read('family',familyId);
    const now=clock();
    if(!Number.isSafeInteger(now)||
       family.purpose!=='desktop_owner_v4'||
       family.accountId!==accountId||
       family.familyId!==familyId||
       family.accountSessionId!==accountSessionId||
       !Number.isSafeInteger(family.expiresAt)||family.expiresAt<=now)
      throw invalid();
    // Exact single-Owner and Portal session check from Operator authority.
    // Owner transfer/logout disables access even if Redis TTL remains.
    if(accounts.desktopOwnerSessionActive(accountId,accountSessionId)!==true)
      throw invalid();
    return family;
  }

  async function inspectNativeAccess(accessToken){
    const record=await read('access',accessToken);
    if(record.purpose!=='desktop_owner_v4')throw invalid();
    const family=await activeFamily(
      record.accountId,record.familyId,record.accountSessionId
    );
    return Object.freeze({
      verified:true,isOwner:true,accountId:family.accountId,
      familyId:family.familyId,resource:DESKTOP_OWNER_RESOURCE,
      scope:DESKTOP_OWNER_SCOPE
    });
  }
  async function verifyOwnerFamilyCurrent(accountId,familyId){
    if(!ACCOUNT.test(String(accountId||''))||
       !TOKEN.test(String(familyId||'')))return false;
    try{
      const family=await read('family',familyId);
      await activeFamily(accountId,familyId,family.accountSessionId);
      return true;
    }catch{return false;}
  }

  return Object.freeze({inspectNativeAccess,verifyOwnerFamilyCurrent});
}

export function createDesktopWallSsoTrustedOperatorV4({
  enabled=false,redis,prefix,accounts,enrollments,
  clock=Date.now,random=crypto.randomBytes
}={}){
  // Fail closed before trying to open Redis or touch device enrollment.
  if(enabled!==true)return Object.freeze({enabled:false,authority:null});
  if(!redis||!['set','get','getDel'].every(m=>typeof redis[m]==='function')||
     !enrollments||typeof enrollments.binding!=='function'||
     typeof enrollments.verifyChannel!=='function')
    throw internal();
  const owner=createDesktopOwnerRedisProofV4({
    redis,prefix,accounts,clock
  });
  const device=createDesktopWallSsoDeviceProofV4({enrollments});
  const authority=createDesktopWallSsoV4({
    redis,prefix,clock,random,
    inspectNativeAccess:owner.inspectNativeAccess,
    verifyOwnerFamilyCurrent:owner.verifyOwnerFamilyCurrent,
    verifyEnrolledDevice:device.verifyEnrolledDevice,
    verifySignedWallDevice:device.verifySignedWallDevice
  });
  // No automatic HTTP route registration and no A/B grant side effects.
  return Object.freeze({
    enabled:true,
    issue:authority.issue,
    redeem:authority.redeem,
    assertWallSessionCurrent:authority.assertWallSessionCurrent
  });
}
