'use strict';
importScripts('shared.js','wall.js');
const memory=LightRemoteMemory,inFlight=new Map();
async function expire(){
 const rows=await chrome.storage.session.get(['pendingWall','restore']);
 for(const key of ['pendingWall','restore'])if(rows[key]&&Date.now()>=rows[key].expiresAt)await chrome.storage.session.remove(key);
}
chrome.storage.session.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
chrome.alarms.create('memory-content-expiry',{periodInMinutes:1});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='memory-content-expiry')void expire();});
chrome.runtime.onStartup?.addListener(()=>void expire());
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return false;
 (async()=>{
  await expire();
  if(!['LRLM_PAIR_WALL','LRLM_PREPARE_WALL'].includes(request?.type))throw Error('unsupported_action');
  const target=memory.wall(request.url);
  if(!await chrome.permissions.contains({origins:[target.permission]}))throw Error('wall_permission_required');
  const {profile}=await chrome.storage.local.get('profile');
  const pair=request.type==='LRLM_PAIR_WALL';
  if(!pair&&(!profile||profile.url!==target.url||!await memory.validCapture(request.snapshot)))throw Error('pair_wall_and_review_capture_first');
  const tab=await chrome.tabs.create({url:target.url,active:true});
  const pending={tabId:tab.id,generation:crypto.randomUUID(),url:target.url,pair,expiresAt:Date.now()+memory.ttlMs,
   ...(pair?{}:{profile,snapshot:request.snapshot})};
  await chrome.storage.session.set({pendingWall:pending,lastStatus:'Sign in to your selected Wall if prompted.'});
  respond({ok:true});void maybePrepare(tab.id);
 })().catch(()=>respond({ok:false,error:'Wall was not opened. Pair your selected device and review the capture first.'}));
 return true;
});
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='complete')void maybePrepare(id);});
chrome.tabs.onRemoved.addListener(async id=>{
 const {pendingWall}=await chrome.storage.session.get('pendingWall');
 if(pendingWall?.tabId===id)await chrome.storage.session.remove('pendingWall');
});
function maybePrepare(id){
 if(inFlight.has(id))return inFlight.get(id);
 const promise=prepare(id).finally(()=>inFlight.delete(id));inFlight.set(id,promise);return promise;
}
async function prepare(id){
 try{
  await expire();const {pendingWall:p}=await chrome.storage.session.get('pendingWall');if(!p||p.tabId!==id)return;
  const tab=await chrome.tabs.get(id);if(tab.url!==p.url)return; // no silent redirect/account/endpoint fallback
  const run=(func,args)=>chrome.scripting.executeScript({target:{tabId:id},world:'ISOLATED',func,args}).then(rows=>rows[0]?.result);
  const identity=await run(lightRemoteLmWallIdentity,[p.url]);
  if(!identity?.ok){await chrome.storage.session.set({lastStatus:'Sign in to the selected Wall, then reload it to continue.'});return;}
  const current=await chrome.storage.session.get('pendingWall');
  if(current.pendingWall?.generation!==p.generation||Date.now()>=p.expiresAt)return;
  if(p.pair){
   await chrome.storage.local.set({profile:{url:p.url,accountId:identity.accountId,deviceId:identity.deviceId,name:identity.name}});
   await chrome.storage.session.remove(['pendingWall','restore']);
   await chrome.storage.session.set({lastStatus:'Paired with '+identity.name+'. Capture a conversation when you are ready.'});return;
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
 }catch{await chrome.storage.session.set({lastStatus:'Wall not ready. Sign in and reload the selected Wall to continue.'});}
}
