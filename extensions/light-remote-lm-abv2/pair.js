'use strict';
const allow=document.getElementById('allow'),openWall=document.getElementById('open-wall');
const status=document.getElementById('status');
let target,tabId;

function showProgress(progress){
 if(!target||progress?.url!==target.url)return;
 status.textContent=progress.message;
 tabId=progress.tabId;
 openWall.hidden=progress.state!=='sign_in';
}

try{
 target=LightRemoteMemory.wall(new URL(location.href).searchParams.get('wall'));
 document.getElementById('wall-address').textContent=target.url;
 allow.disabled=false;
}catch{status.textContent='Open the Light Remote extension and enter your Wall address again.';}

chrome.storage.onChanged.addListener((changes,area)=>{
 if(area==='session'&&changes.pairProgress)showProgress(changes.pairProgress.newValue);
});
allow.addEventListener('click',async()=>{
 allow.disabled=true;
 openWall.hidden=true;
 status.textContent='Waiting for Chrome permission…';
 try{
  if(!await chrome.permissions.request({origins:[target.permission]})){
   status.textContent='Chrome access was declined. Select Allow and pair to try again.';
   return;
  }
  status.textContent='Checking your selected Wall…';
  const reply=await chrome.runtime.sendMessage({type:'LRLM_PAIR_WALL',url:target.url});
  if(!reply?.ok)throw Error(reply?.error??'Pairing could not begin.');
  const {pairProgress}=await chrome.storage.session.get('pairProgress');
  showProgress(pairProgress);
 }catch(error){status.textContent=error.message??'Pairing could not finish.';}
 finally{allow.disabled=false;}
});
openWall.addEventListener('click',async()=>{
 try{await chrome.tabs.update(tabId,{active:true});}
 catch{openWall.hidden=true;status.textContent='The Wall tab was closed. Select Allow and pair to try again.';}
});
