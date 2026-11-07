import {useCallback,useEffect,useRef,useState} from 'react';
import {nativeOwnerActivityPage,type ActivityKind,type ActivityPage} from './native-activity';
import {nativeOwnerSnapshotAvailable} from './native-snapshot';
import type {OwnerSession,OwnerJob} from './native-snapshot';
import type {UsageDeviceRow} from './native-activity';
// A separate read-only lane: old Owner responses never cross signout/account swap.
export function useOwnerActivity(kind:ActivityKind,accountId:string|null){
 const [pages,setPages]=useState<ReadonlyArray<ActivityPage>>([]);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const generation=useRef(0),inflight=useRef(false);
 useEffect(()=>{
  const seq=++generation.current;
  setPages([]);setError(null);inflight.current=false;
  if(!accountId||!nativeOwnerSnapshotAvailable())return;
  inflight.current=true;setPending(true);
  void nativeOwnerActivityPage(accountId,kind).then(result=>{
   if(generation.current!==seq)return;
   if(result.state==='ready'&&result.kind===kind)setPages([result]);
   else setError('Verified Owner activity page unavailable');
  }).finally(()=>{
   if(generation.current===seq){inflight.current=false;setPending(false);}
  });
  return()=>{generation.current++;inflight.current=false;};
 },[accountId,kind]);
 const last=pages.at(-1);
 const loadMore=useCallback(async()=>{
  if(!accountId||!last||last.kind!==kind||last.accountId!==accountId||
     !last.coverage.hasMore||!last.coverage.nextCursor||inflight.current)return;
  const seq=generation.current,cursor=last.coverage.nextCursor;
  inflight.current=true;setPending(true);setError(null);
  try{
   const reply=await nativeOwnerActivityPage(accountId,kind,cursor);
   if(generation.current!==seq)return;
   if(reply.state!=='ready'||reply.kind!==kind||
      reply.coverage.total!==last.coverage.total||
      reply.coverage.source!==last.coverage.source||!reply.rows.length||
      (kind==='usage'&&reply.kind==='usage'&&last.kind==='usage'&&reply.month!==last.month)){
    setError('Owner activity changed or cursor expired. Reopen tab to refresh.');
    return;
   }
   const key=(row:OwnerJob|OwnerSession|UsageDeviceRow)=>
    'jobId' in row?row.jobId:'sessionId' in row?row.sessionId:row.deviceId;
   const seen=new Set(pages.flatMap(p=>p.rows.map(key)));
   if(reply.rows.some(row=>seen.has(key(row)))){
    setError('Overlapping Owner activity page rejected. Reopen tab to refresh.');
    return;
   }
   setPages(previous=>generation.current===seq&&
       previous.at(-1)?.coverage.nextCursor===cursor?[...previous,reply]:previous);
  }finally{
   if(generation.current===seq){inflight.current=false;setPending(false);}
  }
 },[accountId,kind,last,pages]);
 return {
  pages,rows:pages.reduce<Array<OwnerJob|OwnerSession|UsageDeviceRow>>((a,p)=>{
   a.push(...p.rows);return a;
  },[]),
  total:last?.coverage.total??null,loaded:pages.reduce((n,p)=>n+p.rows.length,0),
  hasMore:last?.coverage.hasMore??false,pending,error,loadMore
 };
}
