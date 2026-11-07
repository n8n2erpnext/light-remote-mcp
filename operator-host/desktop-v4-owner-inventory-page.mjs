// T11-F14: independent Owner-only, bounded inventory pagination. No grants or
// device authority is created by a cursor. Current Owner/family checks run on
// EVERY page, and a changed membership revision rejects stale traversal.
import crypto from 'node:crypto';

const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const SESSION=/^acctsess_[a-f0-9-]{36}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,128}$/;
const SHORT=/^[0-9A-HJKMNP-TV-Z]{6}$/;
const deny=(reason,status=403)=>{throw Object.assign(new Error(reason),{status});};
const safeText=(value,max=160)=>typeof value==='string'?value.slice(0,max):null;
const finite=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const fingerprint=(accountId,kind,keys,ownerRevision)=>crypto.createHash('sha256')
  .update(JSON.stringify([accountId,kind,ownerRevision,...keys])).digest('hex');
const next=(payload)=>Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
function parseCursor(cursor){
 if(typeof cursor!=='string'||cursor.length>512||cursor.length<10||
    !/^[A-Za-z0-9_-]+$/.test(cursor))deny('desktop_inventory_cursor_invalid',400);
 try{
   const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
   if(next(parsed)!==cursor||parsed?.v!==1||typeof parsed.kind!=='string'||
      !ACCOUNT.test(parsed.accountId||'')||
      typeof parsed.lastKey!=='string'||parsed.lastKey.length>300||
      !/^[a-f0-9]{64}$/.test(parsed.revision||'')||
      !Number.isSafeInteger(parsed.limit)||parsed.limit<1||parsed.limit>100)
     deny('desktop_inventory_cursor_invalid',400);
   return parsed;
 }catch(e){if(e?.status)throw e;deny('desktop_inventory_cursor_invalid',400);}
}
export function createDesktopV4OwnerInventoryPage({
 accounts,allDeviceViews,accessGrants,lookupShortIds=async()=>new Map(),
 now=Date.now,maxPageSize=100
}={}){
 if(!accounts?.desktopOwnerSessionActive||!accounts?.account||
    typeof allDeviceViews!=='function'||!accessGrants?.activeGrantsForDevices||
    typeof lookupShortIds!=='function')deny('desktop_inventory_dependencies_missing',503);
 return async function page({accountId,accountSessionId,page}={}){
   if(!ACCOUNT.test(accountId||'')||!SESSION.test(accountSessionId||'')||
      !accounts.desktopOwnerSessionActive(accountId,accountSessionId))
     deny('desktop_inventory_owner_required',403);
   const account=accounts.account(accountId);
   if(account?.accountId!==accountId||account.isOwner!==true||
      account.emailVerified!==true||account.status!=='active')
     deny('desktop_inventory_owner_required',403);
   if(!page||typeof page!=='object'||Array.isArray(page)||
      !['devices','grants'].includes(page.kind))
     deny('desktop_inventory_kind_invalid',400);
   const kind=page.kind,limit=page.limit===undefined?Math.min(100,maxPageSize):page.limit;
   if(!Number.isSafeInteger(limit)||limit<1||limit>maxPageSize||limit>100)
     deny('desktop_inventory_limit_invalid',400);
   if(page.cursor!=null&&typeof page.cursor!=='string')
     deny('desktop_inventory_cursor_invalid',400);
   const cursor=page.cursor?parseCursor(page.cursor):null;
   if(cursor&&(cursor.accountId!==accountId||cursor.kind!==kind||
       cursor.limit!==limit))deny('desktop_inventory_cursor_scope_mismatch',403);
   // Scope before any projection, sorting or Short ID lookup; no client-supplied
   // IDs are accepted and no foreign account/device can enter a page.
   const all=allDeviceViews({accountId}).filter(d=>d.accountId===accountId&&DEVICE.test(d.deviceId||''));
   const byId=new Map(all.map(d=>[d.deviceId,d]));
   const eligible=all.filter(d=>d.state!=='revoked');
   let raw;
   if(kind==='devices') {
     raw=all.map(d=>({key:d.deviceId,device:d}))
       .sort((a,b)=>a.key.localeCompare(b.key,'en'));
   }else{
     const groups=accessGrants.activeGrantsForDevices(eligible.map(d=>d.deviceId));
     if(!(groups instanceof Map))deny('desktop_inventory_grants_unavailable',503);
     raw=[];
     for(const [deviceId,grants] of groups){
       if(!byId.has(deviceId)||byId.get(deviceId).state==='revoked'||
          !Array.isArray(grants))continue;
       for(const g of grants){
         if(g.accountId!==accountId||String(g.purpose||'device')!=='device'||
            !DEVICE.test(g.deviceId||'')||g.deviceId!==deviceId||
            typeof g.grantId!=='string'||!/^[A-Za-z0-9._:-]{1,160}$/.test(g.grantId))continue;
         raw.push({key:g.deviceId+'\u0000'+g.grantId,grant:g});
       }
     }
     raw.sort((a,b)=>a.key.localeCompare(b.key,'en'));
   }
   const revision=fingerprint(accountId,kind,raw.map(r=>kind==='devices'
     ?r.key+'|'+r.device.state+'|'+String(r.device.revokedAt||'')
     :r.key),accounts.ownerRevision??null);
   if(cursor&&revision!==cursor.revision)deny('desktop_inventory_cursor_stale',409);
   const start=cursor?raw.findIndex(row=>row.key===cursor.lastKey)+1:0;
   if(cursor&&start===0)deny('desktop_inventory_cursor_invalid',400);
   const window=raw.slice(start,start+limit);
   let rows;
   if(kind==='devices'){
     const deviceIds=window.filter(x=>x.device.state!=='revoked').map(x=>x.device.deviceId);
     let ids;
     try{ids=await lookupShortIds({accountId,deviceIds});}
     catch{deny('desktop_inventory_short_ids_unavailable',503);}
     if(!(ids instanceof Map))deny('desktop_inventory_short_ids_unavailable',503);
     // PG043 lookup is awaited: a device could be revoked/relinked meanwhile.
     // Re-read the server Owner registry before returning any old membership.
     const current=allDeviceViews({accountId})
       .filter(d=>d.accountId===accountId&&DEVICE.test(d.deviceId||''))
       .sort((a,b)=>a.deviceId.localeCompare(b.deviceId,'en'));
     const currentRevision=fingerprint(accountId,kind,current.map(d=>
       d.deviceId+'|'+d.state+'|'+String(d.revokedAt||'')),accounts.ownerRevision??null);
     if(currentRevision!==revision)deny('desktop_inventory_membership_changed_during_read',409);
     rows=window.map(({device:d})=>({
       deviceId:d.deviceId,
       name:safeText(d.displayName||d.deviceName||d.name||d.label,120),
       shortId:d.state!=='revoked'&&SHORT.test(String(ids.get(d.deviceId)||''))?ids.get(d.deviceId):null,
       os:safeText(d.platform||d.os,60),
       state:['online','offline','revoked','disconnected','dormant'].includes(d.state)?d.state:'unknown',
       lastSeenAt:finite(d.lastSeenAt)
     }));
   }else{
     rows=window.map(({grant:g})=>({
       grantId:g.grantId,deviceId:g.deviceId,agentId:safeText(g.agentId,160),
       approvedAt:finite(g.approvedAt),
       expiresAt:finite(Math.min(g.expiresAt||Infinity,g.absoluteExpiresAt||Infinity)),
       absoluteExpiresAt:finite(g.absoluteExpiresAt)
     }));
   }
   const current=accounts.account(accountId);
   if(!accounts.desktopOwnerSessionActive(accountId,accountSessionId)||
      current?.accountId!==accountId||current.isOwner!==true||
      current.emailVerified!==true||current.status!=='active')
     deny('desktop_inventory_owner_revoked_during_read',403);
   const more=start+window.length<raw.length;
   return Object.freeze({
     ok:true,kind,accountId,asOf:now(),rows,
     coverage:{returned:rows.length,total:raw.length,hasMore:more,
       nextCursor:more?next({v:1,kind,accountId,lastKey:window.at(-1).key,revision,limit}):null,
       source:'owner_live_membership_revision'}
   });
 };
}
