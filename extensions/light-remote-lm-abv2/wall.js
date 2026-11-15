'use strict';
// Self-contained injected functions: only explicit popup actions invoke them.
async function lightRemoteLmWallIdentity(expectedUrl){
 if(location.href.split(/[?#]/)[0]!==expectedUrl)return {ok:false,error:'wrong_wall'};
 try{
  const r=await fetch('/api/status',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
  const flags=await fetch('/api/gold/modules',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)}).then(x=>x.json());
  const local=j.local;
  if(!r.ok||!j.ok||!local?.accountId||!local.deviceId||!flags.ok)return {ok:false,error:'wall_owner_sign_in_required'};
  return {ok:true,accountId:local.accountId,deviceId:local.deviceId,name:local.deviceName??local.deviceId,memoryEnabled:flags.modules?.longMemory===true||flags.flags?.longMemory===true};
 }catch{return {ok:false,error:'wall_owner_sign_in_required'};}
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
  const endpoint=kind==='context'?'context/read':'handoff';
  const r=await fetch('/api/gold/modules/scope/'+endpoint+'?scopeId='+encodeURIComponent(id),{cache:'no-store',credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(5000)}),j=await r.json();
  if(!r.ok||!j.ok)throw Error('memory_read_unavailable');
  let text,title,revision;
  if(kind==='context'){
   const c=j.context;if(c?.available!==true||c.scopeId!==id||c.integrity!=='full_context_verified'||typeof c.text!=='string')throw Error('verified_context_unavailable');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(c.text));
   const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==c.sha256)throw Error('memory_integrity_failed');text=c.text;title=c.title;revision=c.checkpointRevision;
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
