'use strict';
// Self-contained injected functions: only explicit popup actions invoke them.
async function lightRemoteLmWallIdentity(expectedUrl){
 if(location.href.split(/[?#]/)[0]!==expectedUrl)return {ok:false,error:'wrong_wall'};
 try{
  const options={credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)};
  const [r,modules]=await Promise.all([fetch('/api/status',options),fetch('/api/gold/modules',options)]);
  if(r.status===401||modules.status===401||modules.status===403)return {ok:false,error:'wall_owner_sign_in_required'};
  if(!r.ok||!modules.ok)return {ok:false,error:'wall_unavailable'};
  const [j,flags]=await Promise.all([r.json(),modules.json()]);
  const local=j.local;
  if(!j.ok||!flags.ok)return {ok:false,error:'wall_unavailable'};
  if(!local?.accountId||!local.deviceId)return {ok:false,error:'wall_not_enrolled'};
  return {ok:true,accountId:local.accountId,deviceId:local.deviceId,name:local.deviceName??local.deviceId,memoryEnabled:flags.modules?.longMemory===true||flags.flags?.longMemory===true};
 }catch{return {ok:false,error:'wall_unavailable'};}
}
async function lightRemoteLmStageWall(profile,snapshot,generation,expiresAt){
 if(location.href.split(/[?#]/)[0]!==profile.url)return {ok:false,error:'wrong_wall'};
 try{
  const r=await fetch('/api/status',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
  const f=await fetch('/api/gold/modules',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)}).then(r=>r.json());
  if(!r.ok||!j.ok||j.local?.accountId!==profile.accountId||j.local.deviceId!==profile.deviceId||!f.ok||f.modules?.longMemory!==true)return {ok:false,error:'wall_identity_changed'};
 }catch{return {ok:false,error:'wall_owner_sign_in_required'};}
 if(Date.now()>=expiresAt||location.href.split(/[?#]/)[0]!==profile.url)return {ok:false,error:'import_expired_or_page_changed'};
 const textarea=document.getElementById('goldContextText'),title=document.getElementById('goldContextTitle'),scope=document.getElementById('goldReaderScope');
 if(!textarea||!title||!scope)return {ok:false,error:'wall_not_ready'};
 if(textarea.dataset.lrImportGeneration===generation)return {ok:true,duplicate:true};
 if(textarea.value.trim()||title.value.trim())return {ok:false,error:'wall_draft_not_empty'};
 // Never choose a scope, opt in, click Save, or overwrite an edited import.
 textarea.dataset.lrImportGeneration=generation;textarea.value=snapshot.text;
 textarea.dispatchEvent(new Event('input',{bubbles:true}));
 title.value=(snapshot.provider==='claude'?'Claude':'ChatGPT')+' · '+new Date(snapshot.capturedAt).toLocaleString();
 title.dispatchEvent(new Event('input',{bubbles:true}));
 const details=document.getElementById('goldMemoryContextDetails');if(details)details.open=true;
 const panel=document.getElementById('goldModulesPanel');if(panel)panel.open=true;
 const status=document.getElementById('goldContextStatus');
 if(status)status.textContent='Conversation prepared, not saved. Review the text, choose your work and save when ready.';
 return {ok:true,prepared:true};
}
async function lightRemoteLmReadMemory(profile,kind){
 if(location.href.split(/[?#]/)[0]!==profile.url)return {ok:false,error:'wrong_wall'};
 const id=document.getElementById('goldReaderScope')?.value;
 if(!/^[a-f0-9-]{36}$/i.test(id??''))return {ok:false,error:'select_work_first'};
 try{
  const identity=async()=>{
   const r=await fetch('/api/status',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
   if(!r.ok||!j.ok||j.local?.accountId!==profile.accountId||j.local.deviceId!==profile.deviceId)throw Error('wall_identity_changed');
  };
  await identity();
  const browser=kind==='browser';
  const endpoint=browser?'browser-context':kind==='context'?'context/read':'handoff';
  const r=await fetch('/api/gold/modules/scope/'+endpoint+'?scopeId='+encodeURIComponent(id),{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
  if(!r.ok||!j.ok)throw Error('memory_read_unavailable');
  let text,title,revision;
  if(kind==='context'||browser){
   const c=j.context,integrity=browser?'browser_context_sha256_verified':'full_context_verified';
   if(c?.available!==true||c.scopeId!==id||c.integrity!==integrity||typeof c.text!=='string')throw Error('verified_context_unavailable');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.text));
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==c.sha256)throw Error('memory_integrity_failed');text=c.text;title=c.title;revision=browser?new Date(c.savedAt).toLocaleString():c.checkpointRevision;
  }else{
   const h=j.handoff;if(h?.scopeId!==id||h.stale!==false||!Array.isArray(h.checkpoints)||!h.checkpoints.length||h.checkpoints.some(c=>c.integrity!=='home_ed25519_verified'||typeof c.body!=='string'))throw Error('verified_history_unavailable');
   text=h.checkpoints.map(c=>'## '+c.title+'\n'+c.body).join('\n\n');title=h.displayName;revision=h.revision;
  }
  await identity();
  if(document.getElementById('goldReaderScope')?.value!==id)throw Error('selected_work_changed');
  if(new TextEncoder().encode(text).byteLength>512*1024)throw Error('context_too_large');
  return {ok:true,text,title,scopeId:id,revision,accountId:profile.accountId,deviceId:profile.deviceId};
 }catch{return {ok:false,error:'verified_memory_read_unavailable_or_identity_changed'};}
}

async function lightRemoteLmBrowserContextWall(profile,action,payload={}){
 const failure=(error,code='wall_unavailable')=>({ok:false,error,code});
 if(location.href!==profile.url)return failure('Open the paired Long Memory Wall.');
 try{
  const options={credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)};
  const base='/api/gold/modules/browser-context';
  const r=await fetch(base+'/targets',options);
  if(r.status===404)return failure('Update Light Remote on the paired device to use auto-capture.','wall_upgrade_required');
  if(r.status===401||r.status===403)return failure('Sign in to the paired Wall as its owner.');
  const targets=await r.json();
  if(!r.ok||!targets.ok)return failure('Turn on Long Memory in the paired Wall.');
  if(targets.accountId!==profile.accountId||targets.deviceId!==profile.deviceId){
   return failure('The paired Wall identity changed. Pair it again.','wall_identity_changed');
  }
  if(action==='targets')return {ok:true,scopes:targets.scopes};
  if(!['start','save','stop'].includes(action)||typeof targets.csrf!=='string'||!targets.csrf){
   return failure('The paired Wall session is not ready. Reload it and try again.');
  }
  const saved=await fetch(base,{...options,signal:AbortSignal.timeout(8000),method:'POST',
   headers:{'content-type':'application/json','x-light-remote-csrf':targets.csrf},
   body:JSON.stringify({...payload,action,accountId:profile.accountId,deviceId:profile.deviceId})});
  const result=await saved.json();
  if(!saved.ok||!result.ok){
   if(['gold_memory_browser_watch_stopped','gold_memory_browser_home_inactive','gold_scope_not_found'].includes(result.error)){
    return failure('This watch stopped or the selected work is inactive.','watch_stopped');
   }
   return failure('The Wall could not save this browser context.');
  }
  return result;
 }catch{return failure('Open the paired Wall and check its connection.');}
}
