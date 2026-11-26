'use strict';
importScripts('shared.js','wall.js','capture.js','watch.js');
const memory=LightRemoteMemory,inFlight=new Map(),recheck=new Set();
async function tellPair(p,state,message){
 await chrome.storage.session.set({pairProgress:{url:p.url,tabId:p.tabId,state,message},lastStatus:message});
}
async function expire(){
 const rows=await chrome.storage.session.get(['pendingWall','restore']);
 for(const key of ['pendingWall','restore'])if(rows[key]&&Date.now()>=rows[key].expiresAt){
  await chrome.storage.session.remove(key);
  if(key==='pendingWall'&&rows[key].pair)await tellPair(rows[key],'error','Pairing expired. Select Allow and pair to try again.');
 }
}
chrome.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
chrome.alarms.create('memory-content-expiry',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{
 if(alarm.name==='memory-content-expiry'){void expire();void browserWatch.sweep();}
});
chrome.runtime.onStartup?.addListener(()=>void expire());
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 const pair=request?.type==='LRLM_PAIR_WALL';
 const expected=chrome.runtime.getURL(pair?'pair.html':'popup.html');
 if(sender.id!==chrome.runtime.id||sender.url?.split('?')[0]!==expected)return false;
 if(browserWatch.types.has(request?.type)){
  browserWatch.handle(request).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message}));
  return true;
 }
 (async()=>{
  await expire();
  if(!['LRLM_PAIR_WALL','LRLM_PREPARE_WALL'].includes(request?.type))throw Error('unsupported_action');
  const target=memory.wall(request.url);
  if(!await chrome.permissions.contains({origins:[target.permission]}))throw Error('wall_permission_required');
  const {profile}=await chrome.storage.local.get('profile');
  if(!pair&&(!profile||profile.url!==target.url||!await memory.validCapture(request.snapshot)))throw Error('pair_wall_and_review_capture_first');
  const existing=pair?(await chrome.tabs.query({url:target.url})).find(tab=>tab.url===target.url):null;
  const tab=existing??await chrome.tabs.create({url:'about:blank',active:false});
  const pending={tabId:tab.id,generation:crypto.randomUUID(),url:target.url,pair,expiresAt:Date.now()+memory.ttlMs,
   ...(pair?{}:{profile,snapshot:request.snapshot})};
  await chrome.storage.session.set({pendingWall:pending,lastStatus:'Sign in to your selected Wall if prompted.'});
  if(pair)await tellPair(pending,'checking','Checking your selected Wall…');
  // Save the target before navigating so a fast completion event can find it.
  if(existing){
   if((await chrome.tabs.get(tab.id)).status==='complete')void maybePrepare(tab.id);
  }else await chrome.tabs.update(tab.id,{url:target.url,active:!pair});
  respond({ok:true});
 })().catch(()=>respond({ok:false,error:pair?'The Wall could not be opened. Check its address and try again.':'Wall was not opened. Pair your selected device and review the capture first.'}));
 return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{
 void browserWatch.tabUpdated(id,change);
 if(change.status!=='complete')return;
 if(inFlight.has(id))recheck.add(id);
 else void maybePrepare(id);
});
chrome.tabs.onRemoved.addListener(async id=>{
 void browserWatch.stop(id);
 const {pendingWall}=await chrome.storage.session.get('pendingWall');
 if(pendingWall?.tabId===id){
  await chrome.storage.session.remove('pendingWall');
  if(pendingWall.pair)await tellPair(pendingWall,'error','The Wall tab was closed. Select Allow and pair to try again.');
 }
});
function maybePrepare(id){
 if(inFlight.has(id))return inFlight.get(id);
 const promise=prepare(id).finally(()=>{
  inFlight.delete(id);
  if(recheck.delete(id))void maybePrepare(id);
 });
 inFlight.set(id,promise);return promise;
}
async function prepare(id){
 let p;
 try{
  await expire();({pendingWall:p}=await chrome.storage.session.get('pendingWall'));if(!p||p.tabId!==id)return;
  const tab=await chrome.tabs.get(id);
  if(tab.url!==p.url){
   if(tab.url==='about:blank')return;
   if(p.pair){
    const login=new URL('/login',p.url);
    if(tab.url?.split('?')[0]===login.href)await tellPair(p,'sign_in','Open the selected Wall and sign in. Pairing resumes when it returns to Long Memory.');
    else await tellPair(p,'error','Return to Long Memory at the selected Wall address, then try pairing again.');
   }
   return;
  }
  const run=(func,args)=>chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func,args}).then(rows=>rows[0]?.result);
  const identity=await run(lightRemoteLmWallIdentity,[p.url]);
  const current=await chrome.storage.session.get('pendingWall');
  if(current.pendingWall?.generation!==p.generation||Date.now()>=p.expiresAt)return;
  if(!identity?.ok){
   if(p.pair&&identity?.error==='wall_not_enrolled')await tellPair(p,'error','This Wall has no enrolled device. Link the device in Light Remote and try again.');
   else if(p.pair&&identity?.error==='wall_unavailable')await tellPair(p,'error','The selected Wall did not respond. Check its address and try again.');
   else if(p.pair)await tellPair(p,'sign_in','Open the Wall and sign in as its owner. Reload Long Memory to continue.');
   else await chrome.storage.session.set({lastStatus:'Sign in to the selected Wall, then reload it to continue.'});
   return;
  }
  if(p.pair){
   await chrome.storage.local.set({profile:{url:p.url,accountId:identity.accountId,deviceId:identity.deviceId,name:identity.name}});
   await chrome.storage.session.remove(['pendingWall','restore']);
   const next=identity.memoryEnabled?'Open the extension in your conversation to capture it.':'Turn on Long Memory in your Wall before capturing.';
   await tellPair(p,'paired','Paired with '+identity.name+'. '+next);return;
  }
  if(identity.accountId!==p.profile.accountId||identity.deviceId!==p.profile.deviceId||!identity.memoryEnabled){
   await chrome.storage.session.remove('pendingWall');await chrome.storage.session.set({lastStatus:'Device/account changed or Memory is off. Pair the intended device again.'});return;
  }
  const prepared=await run(lightRemoteLmStageWall,[p.profile,p.snapshot,p.generation,p.expiresAt]);
  const after=await chrome.storage.session.get('pendingWall');
  if(after.pendingWall?.generation!==p.generation)return;
  if(prepared?.ok){
   await chrome.storage.session.remove('pendingWall');
   await chrome.storage.session.set({lastStatus:'Conversation prepared. Review, choose your work and save it in the Wall.'});
  }else if(prepared?.error==='wall_draft_not_empty'){
   await chrome.storage.session.remove('pendingWall');await chrome.storage.session.set({lastStatus:'The Wall already has a draft. It was kept. Copy the capture manually or use an empty page.'});
  }
 }catch{
  const {pendingWall}=await chrome.storage.session.get('pendingWall');
  if(!p||pendingWall?.generation!==p.generation)return;
  if(p.pair)await tellPair(p,'error','The selected Wall could not be checked. Make sure it is open and try again.');
  else await chrome.storage.session.set({lastStatus:'Wall not ready. Sign in and reload the selected Wall to continue.'});
 }
}
