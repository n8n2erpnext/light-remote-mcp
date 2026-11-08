// Gold P2-I2h2d owner A/B V2 pending preview; optional Owner B approval (OFF by default).
// OFF by default: no visible UI unless both portal + Operator gates accept it.
(() => {
 'use strict';
 const panel=document.getElementById('abv2Panel');
 if(!panel)return;
 const select=document.getElementById('abv2Device');
 const refresh=document.getElementById('abv2Reload');
 const list=document.getElementById('abv2Pending');
 const status=document.getElementById('abv2Status');
 const nonce=new Map();
 let generation=0;
 function msg(value){status.textContent=String(value||'');}
 async function request(action,opts={}){
  const params=new URLSearchParams({action});
  if(opts.deviceId&&opts.method!=='POST')params.set('deviceId',opts.deviceId);
  if(opts.requestId&&opts.method!=='POST')params.set('requestId',opts.requestId);
  const r=await fetch('/account/api?'+params,{credentials:'same-origin',cache:'no-store',
   method:opts.method||'GET',
   headers:{...(opts.method==='POST'?{'content-type':'application/json',
      'x-light-abv2-csrf':opts.csrf}:{} )},
   ...(opts.method==='POST'?{body:JSON.stringify(opts.body||{})}:{})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Object.assign(new Error(j.error||'A/B V2 unavailable'),{status:r.status});
  return j;
 }
 function item(tag,text,cls){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  e.textContent=String(text);
  return e;
 }
 function clear(){list.replaceChildren();}
 async function csrf(deviceId){
  if(!nonce.has(deviceId)){
   const data=await request('abv2-csrf',{deviceId});
   if(!/^[A-Za-z0-9_-]{43}$/.test(String(data.csrf||'')))throw Error('CSRF unavailable');
   nonce.set(deviceId,data.csrf);
  }
  return nonce.get(deviceId);
 }
 async function mutate(action,requestId,attempt){
  const deviceId=select.value;
  if(!deviceId||!/^av2_[a-f0-9]{32}$/.test(requestId))return;
  if(!window.confirm(action==='abv2-refresh'?
   'Refresh this Agent request? The previous A suffix and B code become invalid.':
   'Deny this specific pending Agent request?'))return;
  try{
   refresh.disabled=true;
   await request(action,{method:'POST',csrf:await csrf(deviceId),
    body:{deviceId,requestId,...(action==='abv2-refresh'?{expectedAttempt:attempt}:{})}});
   await load();
  }catch(error){msg('Request not changed: '+error.message);}
  finally{refresh.disabled=false;}
 }
 async function approve(row,input,button){
  const deviceId=select.value;
  const value=String(input.value||'').trim().toUpperCase();
  if(!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(value)){
   msg('Enter the 4+4 B code shown to this Agent.');return;
  }
  if(!window.confirm('Approve this Agent for up to 24 hours on this device?'))return;
  try{
   button.disabled=true;
   const response=await request('abv2-approve',{method:'POST',csrf:await csrf(deviceId),
    body:{deviceId,requestId:row.requestId,expectedAttempt:row.attempt,bCode:value}});
   input.value='';
   if(response.state!=='granted')throw Error('Grant not yet durable');
   await load();
  }catch(error){input.value='';msg('Approval not completed: '+error.message);}
  finally{button.disabled=false;}
 }
 async function generateWallConsent(row,target,button){
  const deviceId=select.value;
  if(!window.confirm('Authorize this exact Agent request for Local Wall approval? The code expires in 90 seconds.'))return;
  try{
   button.disabled=true;
   const data=await request('abv2-wall-consent',{method:'POST',csrf:await csrf(deviceId),
    body:{deviceId,requestId:row.requestId,expectedAttempt:row.attempt}});
   if(!/^[A-Za-z0-9_-]{32}$/.test(String(data.consentCode||'')))
    throw Error('Owner consent unavailable');
   target.textContent='One-time consent (paste on Local Wall): '+data.consentCode+
    ' · expires '+new Date(Number(data.expiresAt)).toLocaleTimeString();
  }catch(error){target.textContent='Consent unavailable: '+error.message;}
  finally{button.disabled=false;}
 }
 async function load(){
  const turn=++generation,deviceId=select.value;
  clear();
  if(!deviceId){msg('Select a device.');return;}
  msg('Checking current pending requests…');
  try{
   const data=await request('abv2-pending',{deviceId});
   if(turn!==generation)return;
   const rows=Array.isArray(data.pending)?data.pending:[];
   if(!rows.length){msg('No Agent-initiated pending requests. Existing manual pairing on the device remains available.');return;}
   msg(rows.length+' pending request'+(rows.length===1?'':'s')+
    ' · B code is shown only to the requesting Agent.');
   for(const row of rows){
    const card=item('div','', 'device-card');
    const meta=item('div','Agent: '+(row.requester||'Authorized Agent')+
      ' · expires '+new Date(Number(row.expiresAt)).toLocaleTimeString());
    const code=item('code',String(row.aCode||''));
    const buttons=item('div','','row');
    const rotate=item('button','Refresh this request','btn');
    const deny=item('button','Deny','btn danger');
    rotate.type='button';deny.type='button';
    rotate.addEventListener('click',()=>mutate('abv2-refresh',row.requestId,row.attempt));
    deny.addEventListener('click',()=>mutate('abv2-deny',row.requestId));
    buttons.append(rotate,deny);
    if(data.ownerApproveEnabled===true){
     const input=document.createElement('input');
     input.type='password';input.autocomplete='off';input.maxLength=9;
     input.placeholder='B code from Agent';
     input.setAttribute('aria-label','Agent B approval code');
     const action=item('button','Approve Agent','btn');action.type='button';
     action.addEventListener('click',()=>approve(row,input,action));
     buttons.append(input,action);
    }
    if(data.wallConsentEnabled===true){
     const codeView=item('code','No one-time consent issued');
     const issue=item('button','Generate Local Wall consent','btn');
     issue.type='button';
     issue.addEventListener('click',()=>generateWallConsent(row,codeView,issue));
     buttons.append(issue);
     card.append(codeView);
    }
    card.append(meta,code,buttons);
    list.append(card);
   }
  }catch(error){
   if(turn!==generation)return;
   if(error.status===404){panel.hidden=true;panel.style.display='none';return;}
   msg('Pending requests unavailable: '+error.message);
  }
 }
 async function boot(){
  try{
   const data=await request('devices');
   const devices=Array.isArray(data.devices)?data.devices.filter(d=>d.state!=='revoked'):[];
   if(!devices.length)return;
   for(const device of devices){
    if(typeof device.deviceId!=='string')continue;
    const option=document.createElement('option');
    option.value=device.deviceId;
    option.textContent=String(device.displayName||device.deviceId);
    select.append(option);
   }
   if(!select.options.length)return;
   select.selectedIndex=0;
   // Feature status is gated by Operator as well as the portal.
   const probe=await request('abv2-pending',{deviceId:select.value});
   if(!Array.isArray(probe.pending))return;
   panel.hidden=false;panel.style.display='';
   await load();
  }catch{/* Disabled or logged out: preserve current V1 account UI. */}
 }
 select.addEventListener('change',load);
 refresh.addEventListener('click',load);
 void boot();
})();
