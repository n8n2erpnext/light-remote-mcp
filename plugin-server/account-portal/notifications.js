/* Isolated account bell: no third-party resources, no user-controlled HTML injection. */
(()=>{'use strict';
const main=document.querySelector('main.main');
if(!main)return;
const icon='/assets/icons/material/';
const root=document.createElement('div');
root.className='account-bell-container';
root.innerHTML='<button type="button" id="accountBell" class="account-bell-button" aria-label="Notifications" aria-expanded="false"><img class="material-icon" src="'+icon+'notifications.svg" alt=""><span id="accountBellCount" class="account-bell-count" hidden></span></button><section id="accountBellPanel" class="account-bell-panel" aria-label="Recent notifications" hidden><div class="account-bell-heading"><strong>Notifications</strong><a href="/account/inbox">Open inbox</a></div><div id="accountBellItems" class="account-bell-items">Loading…</div></section>';
main.insertBefore(root,main.firstChild);
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let loading=false;
async function refresh(){
 if(loading)return;loading=true;
 try{
  const results=await Promise.all([
   fetch('/account/api?action=team-inbox',{cache:'no-store',credentials:'same-origin'}),
   fetch('/account/api?action=notifications',{cache:'no-store',credentials:'same-origin'})
  ]);
  if(results.some(r=>r.status===401)){return}
  if(results.some(r=>!r.ok))throw Error('unavailable');
  const [team,system]=await Promise.all(results.map(r=>r.json()));
  const list=[...(team.notifications||[]).map(n=>({...n,displayTitle:'Pro Team invitation',displayBody:'Invitation from '+(n.ownerEmail||'a team owner')})),
    ...(system.notifications||[]).map(n=>({...n,displayTitle:n.title,displayBody:n.body}))].sort((a,b)=>b.createdAt-a.createdAt);
  const count=Number(team.unreadCount||0)+Number(system.unreadCount||0);
  $('accountBellCount').hidden=!count;
  $('accountBellCount').textContent=count>99?'99+':String(count);
  $('accountBell').setAttribute('aria-label',count?'Notifications, '+count+' unread':'Notifications');
  $('accountBellItems').innerHTML=list.length?
   list.slice(0,5).map(n=>'<a class="account-bell-item" href="/account/inbox"><strong>'+esc(n.displayTitle)+'</strong><small>'+esc(n.displayBody)+'</small>'+(n.readAt?'':'<i class="account-bell-new">New</i>')+'</a>').join(''):
   '<div class="account-bell-empty">No new notifications.</div>';
 }catch{$('accountBellItems').textContent='Notifications unavailable. Open inbox to retry.'}
 finally{loading=false}
}
$('accountBell').addEventListener('click',()=>{
 const panel=$('accountBellPanel');const nowOpen=panel.hidden;panel.hidden=!nowOpen;
 $('accountBell').setAttribute('aria-expanded',String(nowOpen));
 if(nowOpen)void refresh();
});
document.addEventListener('click',e=>{if(root.contains(e.target))return;$('accountBellPanel').hidden=true;$('accountBell').setAttribute('aria-expanded','false')});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('accountBellPanel').hidden=true;$('accountBell').setAttribute('aria-expanded','false')}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh()});
void refresh();setInterval(()=>{if(!document.hidden)void refresh()},60_000);
})();
