'use strict';

// The watch is bound to the browser tab, canonical chat URL and paired work.
// Session storage contains routing and receipts. The body goes straight to Wall.
const browserWatch=(()=>{
 const prefix='browser-watch:';
 const inflight=new Map();
 const stopping=new Set(),starting=new Set();
 const key=id=>prefix+id;
 const sameProfile=(a,b)=>a?.url===b?.url&&a?.accountId===b?.accountId&&a?.deviceId===b?.deviceId;
 const get=async id=>(await chrome.storage.session.get(key(id)))[key(id)];
 const put=async value=>chrome.storage.session.set({[key(value.tabId)]:value});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const status=({state,message,savedAt,scopeName})=>({state,message,savedAt,scopeName});
 const types=new Set(['LRLM_WATCH_TARGETS','LRLM_WATCH_START','LRLM_WATCH_STOP','LRLM_WATCH_STATUS']);

 async function wallTab(profile,allowOpen){
  const [existing]=await chrome.tabs.query({url:profile.url});
  if(existing?.url===profile.url&&existing.status==='complete')return existing.id;
  if(!allowOpen)throw Error('Open the paired Long Memory Wall in Chrome.');
  const tab=existing??await chrome.tabs.create({url:profile.url,active:false});
  for(let i=0;i<32;i++){
   const current=await chrome.tabs.get(tab.id);
   if(current.status==='complete'){
    if(current.url===profile.url)return tab.id;
    if(current.url&&current.url!=='about:blank')throw Error('Sign in to the paired Wall, then try again.');
   }
   await pause(250);
  }
  throw Error('The paired Wall is still loading. Try again when it is open.');
 }

 async function wall(profile,action,payload,allowOpen=false){
  const id=await wallTab(profile,allowOpen);
  const [frame]=await chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',
   func:lightRemoteLmBrowserContextWall,args:[profile,action,payload]});
  const result=frame?.result;
  if(!result?.ok)throw Object.assign(Error(result?.error??'The paired Wall could not be reached.'),{code:result?.code});
  return result;
 }

 async function stop(id){
  if(stopping.has(id))return;
  stopping.add(id);
  try{
   const current=await get(id);
   if(!current)return;
   await inflight.get(id)?.catch(()=>{});
   await chrome.storage.session.remove(key(id));
   // Wait for an update already in progress, then revoke the exact watch ID.
   try{await wall(current.profile,'stop',{scopeId:current.scopeId,conversationUrl:current.conversationUrl,watchId:current.watchId});}catch{}
  }finally{stopping.delete(id);}
 }

 async function syncOnce(watch){
  const {tabId,profile,scopeId,conversationUrl,watchId}=watch;
  const isCurrent=async()=> (await get(tabId))?.watchId===watchId&&!stopping.has(tabId);
  async function announce(next){
   if(await isCurrent())await put({...watch,...next});
  }
  try{
   const current=await chrome.storage.local.get('profile');
   const tab=await chrome.tabs.get(tabId);
   if(!sameProfile(profile,current.profile)||LightRemoteMemory.conversation(tab.url)!==conversationUrl){
    if(await isCurrent())await chrome.storage.session.remove(key(tabId));
    return;
   }
   const snapshot=await LightRemoteMemory.readSnapshot(async cursor=>{
    const [frame]=await chrome.scripting.executeScript({target:{tabId},world:'ISOLATED',
     func:lightRemoteLmCaptureSegment,args:[cursor]});
    return frame?.result;
   },{onlySettled:true});
   if(LightRemoteMemory.conversation(snapshot.sourceUrl)!==conversationUrl||!await isCurrent())return;
   if(snapshot.sha256===watch.sha256){
    if(watch.state!=='watching')await announce({state:'watching',message:'Watching this conversation.'});
    return;
   }
   const result=await wall(profile,'save',{scopeId,conversationUrl,watchId,text:snapshot.text,sha256:snapshot.sha256});
   await announce({state:'watching',message:'Watching this conversation. Browser context saved.',sha256:snapshot.sha256,savedAt:result.savedAt});
  }catch(error){
   if(['watch_stopped','wall_identity_changed'].includes(error.code)){
    await announce({state:'stopped',message:error.message});
    return;
   }
   let message='Auto-capture will retry when the loaded messages are ready.';
   if(error.message==='conversation_still_generating')message='Waiting for the current reply to finish.';
   else if(error.message?.startsWith('This conversation is too large'))message='The loaded chat exceeds 512 KiB. The last copy in Wall was kept.';
   else if(error.code==='wall_unavailable'||error.message?.startsWith('Open the paired'))message=error.message;
   else if(error.code==='wall_upgrade_required')message=error.message;
   await announce({state:'waiting',message});
  }
 }

 function sync(watch){
  const id=watch.tabId;
  if(watch.state==='stopped'||stopping.has(id)||inflight.has(id))return inflight.get(id);
  const task=syncOnce(watch).finally(()=>inflight.delete(id));
  inflight.set(id,task);
  return task;
 }

 async function sweep(){
  const rows=await chrome.storage.session.get(null);
  await Promise.allSettled(Object.entries(rows).filter(([name])=>name.startsWith(prefix)).map(([,watch])=>sync(watch)));
 }

 async function handle(request){
  const tabId=request.tabId;
  if(!Number.isInteger(tabId)||tabId<0)throw Error('Open the conversation you want to follow.');
  const active=await get(tabId);
  if(request.type==='LRLM_WATCH_STATUS')return {watch:active?status(active):null};
  if(request.type==='LRLM_WATCH_STOP'){await stop(tabId);return {};}
  const tab=await chrome.tabs.get(tabId);
  const conversationUrl=LightRemoteMemory.conversation(tab.url);
  if(!conversationUrl||conversationUrl!==request.conversationUrl)throw Error('Open a saved ChatGPT or Claude conversation first.');
  const {profile}=await chrome.storage.local.get('profile');
  if(!profile)throw Error('Pair a Long Memory Wall first.');
  if(request.type==='LRLM_WATCH_TARGETS')return {scopes:(await wall(profile,'targets',{},true)).scopes};
  if((active&&active.state!=='stopped')||starting.has(tabId)||stopping.has(tabId))throw Error('Wait for the current watch to finish updating.');
  starting.add(tabId);
  try{
   const targets=(await wall(profile,'targets',{},true)).scopes;
   const target=targets.find(scope=>scope.scopeId===request.scopeId);
   if(!target)throw Error('Choose a work stored on this Wall.');
   if(LightRemoteMemory.conversation((await chrome.tabs.get(tabId)).url)!==conversationUrl)throw Error('This conversation changed. Open it and try again.');
   const result=await wall(profile,'start',{scopeId:target.scopeId,conversationUrl,ownerConfirmed:true});
   const watch={tabId,conversationUrl,scopeId:target.scopeId,scopeName:target.displayName,profile,watchId:result.watchId,
    state:'watching',message:'Watching this conversation.'};
   await put(watch);
   void sync(watch);
   return {watch:status(watch)};
  }finally{starting.delete(tabId);}
 }

 async function tabUpdated(id,change){
  if(!change.url)return;
  const watch=await get(id);
  if(watch&&LightRemoteMemory.conversation(change.url)!==watch.conversationUrl)await stop(id);
 }
 return { types,handle,sweep,stop,tabUpdated };
})();
