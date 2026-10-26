// Shared presentation for the owner-authenticated Local Wall notification bell.
// Browser receives only account-scoped previews from the signed Agent channel.
export const notificationBellStyles=`
.wall-notification{position:relative;display:inline-flex;align-items:center}
.wall-notification-toggle{position:relative;display:inline-flex;align-items:center;justify-content:center;border:1px solid #34475a;border-radius:9px;background:#101923;color:#d8e5f2;width:37px;height:35px;cursor:pointer}
.wall-notification-toggle:hover,.wall-notification-toggle[aria-expanded="true"]{border-color:#7d9bb8;background:#182839}
.wall-notification-toggle .mi{width:19px;height:19px}
.wall-notification-badge{position:absolute;top:-7px;right:-7px;background:#f3c753;color:#171c24;min-width:19px;height:19px;border-radius:12px;font-size:10px;font-weight:750;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #080a0c}
.wall-notification-badge[hidden],.wall-notification-panel[hidden]{display:none!important}
.wall-notification-panel{position:absolute;z-index:7000;right:0;top:calc(100% + 9px);width:min(360px,calc(100vw - 25px));max-height:390px;overflow-y:auto;background:#0d141d;border:1px solid #344253;border-radius:12px;box-shadow:0 16px 45px #000a}
.wall-notification-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px;border-bottom:1px solid #2c3947;font-size:13px}
.wall-notification-heading a{color:#a5d4f1;text-decoration:none;font-size:12px}
.wall-notification-row{display:block;padding:12px;border-bottom:1px solid #23303c;text-decoration:none;color:#d7e1eb}
.wall-notification-row:hover{background:#152332}
.wall-notification-title{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
.wall-notification-body{color:#9aa9b9;font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.wall-notification-new{font-size:10px;border-radius:4px;background:#314b60;color:#c3eaff;padding:2px 5px}
.wall-notification-empty{color:#9baabc;padding:14px;font-size:12px}
@media(max-width:690px){.wall-notification-panel{position:fixed;right:10px;top:75px;max-height:65vh}}
`;
export const notificationBellMarkup=`
<div class="wall-notification" id="wallNotificationHost">
 <button type="button" class="wall-notification-toggle" id="wallNotificationBell" aria-expanded="false" aria-controls="wallNotificationPanel" aria-label="Notifications">
  <span aria-hidden="true">🔔</span><span class="wall-notification-badge" id="wallNotificationBadge" hidden></span>
 </button>
 <section class="wall-notification-panel" id="wallNotificationPanel" aria-label="Account notifications" hidden>
  <div class="wall-notification-heading"><strong>Notifications</strong><a id="wallNotificationAll" target="_blank" rel="noopener noreferrer" href="#">View all in Account</a></div>
  <div id="wallNotificationItems" class="wall-notification-empty">Loading notifications…</div>
 </section>
</div>`;
// No credential, HTML injection, or cross-site authenticated fetch. All
// account data comes through the Local Wall's own authorized API.
export const notificationBellScript=`
(()=>{
 const host=document.getElementById('wallNotificationHost');
 if(!host)return;
 const bell=document.getElementById('wallNotificationBell');
 const panel=document.getElementById('wallNotificationPanel');
 const items=document.getElementById('wallNotificationItems');
 const badge=document.getElementById('wallNotificationBadge');
 const all=document.getElementById('wallNotificationAll');
 let loading=false;
 const valid=id=>/^(sys_[a-f0-9-]{36}|tinv_[a-f0-9]{24})$/.test(String(id||''));
 function inboxUrl(value){
  try{
   const url=new URL(value);
   if(!['https:','http:'].includes(url.protocol)||url.pathname!=='/account/inbox'||url.username||url.password)return null;
   url.search='';url.hash='';
   return url;
  }catch{return null;}
 }
 function itemLink(base,id){
  const url=new URL(base.href);
  url.searchParams.set('notificationId',id);
  return url.href;
 }
 async function refreshNotifications(){
  if(loading||document.hidden)return;
  loading=true;
  try{
   const res=await fetch('/api/account-notifications',{cache:'no-store',credentials:'same-origin'});
   if(!res.ok)throw Error('notifications_unavailable');
   const data=await res.json();
   if(data.ok!==true||!Array.isArray(data.notifications))throw Error('notifications_unavailable');
   const base=inboxUrl(data.accountInboxUrl);
   if(!base)throw Error('account_inbox_unavailable');
   all.href=base.href;
   const count=Math.max(0,Math.min(9999,Number(data.unreadCount)||0));
   badge.hidden=count===0;
   badge.textContent=count>99?'99+':String(count);
   bell.setAttribute('aria-label',count?'Notifications, '+count+' unread':'Notifications');
   items.className='';
   items.replaceChildren();
   const notices=data.notifications.filter(n=>valid(n.notificationId)).slice(0,5);
   if(!notices.length){
    items.className='wall-notification-empty';
    items.textContent='No notifications yet.';
   }
   for(const notice of notices){
    const a=document.createElement('a');
    a.className='wall-notification-row';a.href=itemLink(base,notice.notificationId);
    a.target='_blank';a.rel='noopener noreferrer';
    const title=document.createElement('div');title.className='wall-notification-title';
    title.textContent=String(notice.title||'Notification').slice(0,160);
    if(!notice.readAt){const isNew=document.createElement('span');isNew.className='wall-notification-new';isNew.textContent='New';title.append(isNew);}
    const body=document.createElement('div');body.className='wall-notification-body';
    body.textContent=String(notice.body||'').slice(0,300);
    a.append(title,body);items.append(a);
   }
  }catch{
   badge.hidden=true;badge.textContent='';
   items.className='wall-notification-empty';
   items.textContent='Notifications temporarily unavailable.';
   all.removeAttribute('href');
  }finally{loading=false;}
 }
 function close(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 bell.addEventListener('click',()=>{
  const opening=panel.hidden;
  panel.hidden=!opening;bell.setAttribute('aria-expanded',String(opening));
  if(opening)void refreshNotifications();
 });
 document.addEventListener('click',event=>{if(!host.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshNotifications();});
 void refreshNotifications();
 setInterval(()=>{if(!document.hidden)void refreshNotifications();},60000);
})();
`;
