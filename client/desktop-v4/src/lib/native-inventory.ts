// T11-F14: native-only paged Owner inventory. HTTPS bearer stays in Rust;
// no browser fetch/cookies and no cursor can select an Owner or bypass grants.
import type {OwnerDevice,OwnerGrant} from './native-snapshot';
import {nativeOwnerSnapshotAvailable} from './native-snapshot';

export type InventoryKind='devices'|'grants';
export type OwnerInventoryCoverage=Readonly<{
  returned:number;total:number;hasMore:boolean;nextCursor:string|null;
  source:'owner_live_membership_revision';
}>;
export type OwnerInventoryPage=
  | Readonly<{state:'ready';accountId:string;asOf:number;kind:'devices';
    rows:ReadonlyArray<OwnerDevice>;coverage:OwnerInventoryCoverage}>
  | Readonly<{state:'ready';accountId:string;asOf:number;kind:'grants';
    rows:ReadonlyArray<OwnerGrant>;coverage:OwnerInventoryCoverage}>;
export type InventoryView=OwnerInventoryPage|Readonly<{state:'unavailable';reason:string}>;
const CLOSED:InventoryView=Object.freeze({state:'unavailable',reason:'owner_inventory_unavailable'});
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const SHORT=/^[0-9A-HJKMNP-TV-Z]{6}$/;
const CURSOR=/^[A-Za-z0-9_-]{10,512}$/;
const finite=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const id=(v:unknown)=>typeof v==='string'&&ID.test(v)?v:null;
const str=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max?v:null;
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function projectOwnerInventoryPage(input:unknown,accountId:string,kind:InventoryKind):InventoryView{
  const body=record(input),coverage=record(body?.coverage),rows=body?.rows;
  if(!id(accountId)||!['devices','grants'].includes(kind)||body?.ok!==true||
     body.accountId!==accountId||body.kind!==kind||
     finite(body.asOf)===null||!Array.isArray(rows)||rows.length>100||!coverage)return CLOSED;
  const returned=finite(coverage.returned),total=finite(coverage.total);
  const hasMore=coverage.hasMore;
  const nextCursor=coverage.nextCursor;
  if(returned===null||total===null||returned!==rows.length||returned>total||
     typeof hasMore!=='boolean'||coverage.source!=='owner_live_membership_revision'||
     (hasMore&&(!nextCursor||typeof nextCursor!=='string'||!CURSOR.test(nextCursor)||rows.length===0))||
     (!hasMore&&nextCursor!==null))return CLOSED;
  const keys=new Set<string>();
  const result:OwnerInventoryCoverage={returned,total,hasMore,
    nextCursor:hasMore?String(nextCursor):null,source:'owner_live_membership_revision'};
  if(kind==='devices'){
    const out:OwnerDevice[]=[];
    for(const value of rows){
      const d=record(value),deviceId=id(d?.deviceId);
      if(!d||!deviceId||keys.has(deviceId))return CLOSED;
      keys.add(deviceId);
      out.push({deviceId,name:str(d.name,120),shortId:SHORT.test(String(d.shortId||''))?String(d.shortId):null,
        os:str(d.os,60),state:str(d.state,40)||'unknown',lastSeenAt:finite(d.lastSeenAt)});
    }
    return Object.freeze({state:'ready',accountId,asOf:finite(body.asOf)!,kind,rows:out,coverage:result});
  }
  const out:OwnerGrant[]=[];
  for(const value of rows){
    const g=record(value),grantId=id(g?.grantId),deviceId=id(g?.deviceId);
    if(!g||!grantId||!deviceId||keys.has(deviceId+'|'+grantId))return CLOSED;
    keys.add(deviceId+'|'+grantId);
    out.push({grantId,deviceId,agentId:id(g.agentId),approvedAt:finite(g.approvedAt),
      expiresAt:finite(g.expiresAt),absoluteExpiresAt:finite(g.absoluteExpiresAt)});
  }
  return Object.freeze({state:'ready',accountId,asOf:finite(body.asOf)!,kind,rows:out,coverage:result});
}
type NativeWindow=Window & {__TAURI_INTERNALS__?:{invoke?:(cmd:string,args?:unknown)=>Promise<unknown>}};
export function nativeOwnerInventoryAvailable(host:Window=window):boolean{
  return nativeOwnerSnapshotAvailable(host);
}
export async function nativeOwnerInventoryPage(
 accountId:string,kind:InventoryKind,cursor:string|null=null,host:Window=window
):Promise<InventoryView>{
 if(!nativeOwnerInventoryAvailable(host)||!id(accountId)||!['devices','grants'].includes(kind)||
    (cursor!==null&&!CURSOR.test(cursor)))return CLOSED;
 try{
   const response=await (host as NativeWindow).__TAURI_INTERNALS__!.invoke!(
     'desktop_owner_inventory_page',{kind,cursor});
   return projectOwnerInventoryPage(response,accountId,kind);
 }catch{return CLOSED;}
}
