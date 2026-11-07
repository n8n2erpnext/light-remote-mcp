import {useCallback,useEffect,useRef,useState} from 'react';
import {nativeOwnerInventoryAvailable,nativeOwnerInventoryPage,
  type InventoryKind,type OwnerInventoryPage} from './native-inventory';
import type {OwnerDevice,OwnerGrant} from './native-snapshot';

// One read lane per kind+Owner. A signout/account switch invalidates pending
// page responses. No overlapping "Load more", no cached authorization.
export function useOwnerInventory(kind:InventoryKind,accountId:string|null){
  const [pages,setPages]=useState<ReadonlyArray<OwnerInventoryPage>>([]);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const epoch=useRef(0),inFlight=useRef(false);
  useEffect(()=>{
    const current=++epoch.current;
    setPages([]);setError(null);inFlight.current=false;
    if(!accountId||!nativeOwnerInventoryAvailable())return;
    inFlight.current=true;setPending(true);
    void nativeOwnerInventoryPage(accountId,kind).then(reply=>{
      if(current!==epoch.current)return;
      if(reply.state==='ready'&&reply.kind===kind)setPages([reply]);
      else setError('Verified Owner inventory page unavailable');
    }).finally(()=>{
      if(current===epoch.current){inFlight.current=false;setPending(false);}
    });
    return()=>{epoch.current++;inFlight.current=false;};
  },[accountId,kind]);
  const last=pages.at(-1);
  const loadMore=useCallback(async()=>{
    if(!accountId||!last||last.accountId!==accountId||last.kind!==kind||
       !last.coverage.hasMore||!last.coverage.nextCursor||inFlight.current)return;
    const token=epoch.current,cursor=last.coverage.nextCursor;
    inFlight.current=true;setPending(true);setError(null);
    try{
      const reply=await nativeOwnerInventoryPage(accountId,kind,cursor);
      if(epoch.current!==token)return;
      if(reply.state!=='ready'||reply.kind!==kind||
         reply.coverage.total!==last.coverage.total||
         reply.rows.length===0){
        setError('Inventory changed or page unavailable. Reopen this tab to reload.');
        return;
      }
      const existing=new Set(pages.flatMap(page=>page.rows.map(row=>
        'grantId' in row?row.deviceId+'|'+row.grantId:row.deviceId)));
      if(reply.rows.some(row=>existing.has('grantId' in row?row.deviceId+'|'+row.grantId:row.deviceId))){
        setError('Overlapping inventory page rejected. Reopen this tab to reload.');
        return;
      }
      setPages(previous=>{
        if(epoch.current!==token||previous.at(-1)?.coverage.nextCursor!==cursor)return previous;
        return [...previous,reply];
      });
    }finally{
      if(epoch.current===token){inFlight.current=false;setPending(false);}
    }
  },[accountId,kind,last,pages]);
  return {
    pages,
    rows:pages.reduce<Array<OwnerDevice|OwnerGrant>>((all,page)=>{all.push(...page.rows);return all;},[]),
    total:last?.coverage.total??null,
    hasMore:last?.coverage.hasMore??false,
    pending,error,loadMore,
    loaded:pages.reduce((sum,page)=>sum+page.rows.length,0)
  };
}
