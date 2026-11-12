// RM task scopes are separate from durable A/B authority and native observations.
export const RM_TASK_IDLE_MS=45_000;
const owns=(row,owner)=>row.sessionId===String(owner.sessionId||'')&&row.agentId===String(owner.agentId||'');
export function requireOwnedRmTask(rows,owner,id='',{now=Date.now(),closing=false}={}){
  let row;
  if(id){
    row=rows.get(String(id));
    if(!row)throw Error('rm_task_closed_call_desktop_attach');
    if(!owns(row,owner))throw Error('desktop_session_owner_mismatch');
  }else{
    const candidates=[...rows.values()].filter(r=>owns(r,owner)&&!r.closing&&(r.inFlight>0||now<r.expiresAt));
    if(candidates.length>1)throw Error('desktop_session_id_required_multiple_open');
    row=candidates[0];
    if(!row)throw Error('rm_task_session_required_call_desktop_attach');
  }
  if(!closing&&row.closing)throw Error('rm_task_closing_call_desktop_attach_after_close');
  if(!closing&&!(row.inFlight>0)&&now>=row.expiresAt)throw Error('rm_task_expired_call_desktop_attach');
  return row;
}
export function rmTaskMayExpire(row,now=Date.now()){
  return !row.closing&&!(row.inFlight>0)&&now>=row.expiresAt;
}
export async function withRmTask(rows,row,operation,arm){
  if(rows.get(row.desktopSessionId)!==row||row.closing)throw Error('rm_task_closed_call_desktop_attach');
  row.inFlight=(row.inFlight||0)+1;arm(row);
  const pending=Promise.resolve().then(operation);
  (row.pendingOperations??=new Set()).add(pending);
  try{
    const value=await pending;
    return {...value,rmTask:{desktopSessionId:row.desktopSessionId,closeRequired:true,
      closeTool:'light_remote_desktop_detach',closeBeforeFinalReport:true,idleGraceMs:RM_TASK_IDLE_MS}};
  }finally{
    row.pendingOperations.delete(pending);
    row.inFlight=Math.max(0,row.inFlight-1);
    // A response arriving after close must not resurrect a removed/closing scope.
    if(rows.get(row.desktopSessionId)===row&&!row.closing)arm(row);
  }
}
export async function closeRmTask(rows,row,{detach,release,closeIdle}){
  if(row.stopping)return row.stopping;
  row.closing=true;
  if(row.timer){clearTimeout(row.timer);row.timer=null;}
  row.stopping=(async()=>{
    await Promise.allSettled([...(row.pendingOperations||[])]);
    const native=await detach(row);
    if(!native?.detached&&!native?.scopeClosed&&!native?.helperStopped)throw Error('rm_task_close_unconfirmed');
    if(rows.get(row.desktopSessionId)===row)rows.delete(row.desktopSessionId);
    let resourceCleanupWarning=false;
    try{release(row);}catch{resourceCleanupWarning=true;}
    try{closeIdle();}catch{resourceCleanupWarning=true;}
    return {...native,closed:true,taskEnded:true,newAttachRequired:true,resourceCleanupWarning};
  })().finally(()=>{row.stopping=null;});
  return row.stopping;
}
