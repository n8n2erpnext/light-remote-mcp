// M3 Agent concurrency applies to new effects, not process-control actions.
// Desktop pointer operations require a separate M4 exclusive resource lock.
export function usesPersonalAgentSlot({enabled=false,family='',op=''}={}){
 if(enabled!==true)return false;
 const kind=String(family),action=String(op);
 if(kind==='fs')return true;
 if(kind==='scp')return !['status','cancel'].includes(action);
 if(kind==='process')return action==='start';
 if(kind==='terminal')return action==='start';
 if(kind==='search')return action==='start';
 return false;
}
