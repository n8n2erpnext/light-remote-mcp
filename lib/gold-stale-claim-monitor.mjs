// Gold P1-A owner-scoped, read-only periodic M4 stale-claim monitor.
// This module never deletes leases, writes a terminal ACK or mutates PostgreSQL.
// It is explicitly opt-in and requires a nonempty device allowlist in Operator.
import {scanOwnerStaleClaims} from './gold-stale-claim-detector.mjs';
const valid=/^[A-Za-z0-9._:-]{1,160}$/;
export class GoldStaleClaimMonitor {
 constructor({pool,getDeviceViews,allowedDevices,now=Date.now,minimumAgeMs=3600000,
   maxRowsPerAccount=2000,onAlert=()=>{}}={}){
  if(!pool?.query||typeof getDeviceViews!=='function'||typeof now!=='function'||
     !Array.isArray(allowedDevices)||!allowedDevices.length||
     allowedDevices.some(id=>!valid.test(String(id)))||
     !Number.isSafeInteger(minimumAgeMs)||minimumAgeMs<60000||
     !Number.isSafeInteger(maxRowsPerAccount)||maxRowsPerAccount<1||maxRowsPerAccount>2000)
   throw Error('p1_stale_monitor_allowlist_required');
  this.pool=pool;this.getDeviceViews=getDeviceViews;this.allowed=new Set(allowedDevices);
  this.now=now;this.minimumAgeMs=minimumAgeMs;this.maxRowsPerAccount=maxRowsPerAccount;
  this.onAlert=onAlert;this.inFlight=false;this.lastRun=null;this.lastError=null;
  this.byAccount=new Map();
 }
 async tick(){
  if(this.inFlight)return {busy:true};
  this.inFlight=true;
  try{
   const views=this.getDeviceViews();
   if(!Array.isArray(views))throw Error('p1_stale_monitor_device_inventory_unavailable');
   const groups=new Map();
   for(const d of views){
    if(!d||!this.allowed.has(d.deviceId)||d.state==='revoked'||!valid.test(String(d.accountId||'')))continue;
    let ids=groups.get(d.accountId);
    if(!ids){ids=new Set();groups.set(d.accountId,ids);}
    ids.add(d.deviceId);
   }
   const updates=new Map(),now=this.now();
   for(const [accountId,ids] of groups){
    const all=[...ids];
    // Isolate the owner. Stay bounded in each query and fail closed if a
    // single owner exceeds the scanner's safe per-interval allocation.
    if(all.length>200)throw Error('p1_stale_monitor_owner_device_limit');
    const scan=await scanOwnerStaleClaims({pool:this.pool,accountId,deviceIds:all,
      now,minimumAgeMs:this.minimumAgeMs,maxRows:this.maxRowsPerAccount});
    updates.set(accountId,scan);
   }
   // Replace the entire snapshot atomically. A failure cannot leave a stale
   // prior success masquerading as a current reading.
   const previous=this.byAccount;
   this.byAccount=updates;this.lastRun=now;this.lastError=null;
   for(const [accountId,scan] of updates)if(scan.totalCandidates>0&&
    (previous.get(accountId)?.totalCandidates!==scan.totalCandidates||
     previous.get(accountId)?.items.some((item,i)=>
       item.jobId!==scan.items[i]?.jobId||item.classification!==scan.items[i]?.classification)))
    this.onAlert({accountId,claimCount:scan.totalCandidates,observedAt:now,
      mode:'diagnostic_only',releasePerformed:false});
   return {ok:true,ownerCount:updates.size,claimCount:[...updates.values()]
     .reduce((sum,s)=>sum+s.totalCandidates,0),readOnly:true};
  }catch(error){
   this.byAccount.clear();this.lastError=String(error?.message||error);
   throw error;
  }finally{this.inFlight=false;}
 }
 snapshotForOwner(accountId,deviceIds=[]){
  if(!valid.test(String(accountId||''))||!Array.isArray(deviceIds)||
     deviceIds.some(id=>!valid.test(String(id))))throw Error('p1_stale_monitor_owner_scope_invalid');
  const ids=new Set(deviceIds);
  const row=this.byAccount.get(accountId);
  return {enabled:true,observedAt:this.lastRun,error:this.lastError,
    mode:'diagnostic_only',releasePerformed:false,
    staleClaims:(row?.items||[]).filter(item=>ids.has(item.deviceId))
      .map(({accountId:_account,...safe})=>safe)};
 }
}
