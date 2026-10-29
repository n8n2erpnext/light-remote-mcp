// Shared presentation for the owner-authenticated Local Wall notification bell.
// Browser receives only account-scoped previews from the signed Agent channel.
export function assertNotificationOwnerEmail(accountEmail,wallUsername){
 const signed=String(accountEmail||'').trim().toLowerCase();
 const session=String(wallUsername||'').trim().toLowerCase();
 if(!signed||!session||!signed.includes('@')||signed!==session)
  throw new Error('account_notification_session_mismatch');
 return true;
}
export const notificationBellStyles=`
.wall-notification{position:relative;display:inline-flex;align-items:center}
.wall-notification-toggle{position:relative;display:inline-flex;align-items:center;justify-content:center;border:1px solid #34475a;border-radius:9px;background:#101923;color:#d8e5f2;width:37px;height:35px;cursor:pointer}
.wall-notification-toggle:hover,.wall-notification-toggle[aria-expanded="true"]{border-color:#7d9bb8;background:#182839}
.wall-notification-toggle .mi{width:19px;height:19px}
.wall-notification-badge{position:absolute;top:-7px;right:-7px;background:#f3c753;color:#171c24;min-width:19px;height:19px;border-radius:12px;font-size:10px;font-weight:750;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #080a0c}
.wall-notification-badge[hidden],.wall-notification-panel[hidden]{display:none!important}
.wall-notification-panel{position:fixed;z-index:7000;right:auto;left:10px;top:60px;width:min(360px,calc(100vw - 20px));max-height:min(390px,calc(100dvh - 20px));overflow-y:auto;background:#0d141d;border:1px solid #344253;border-radius:12px;box-shadow:0 16px 45px #000a}
.wall-notification-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px;border-bottom:1px solid #2c3947;font-size:13px}
.wall-notification-heading a{color:#a5d4f1;text-decoration:none;font-size:12px}
.wall-notification-row{display:block;padding:12px;border-bottom:1px solid #23303c;text-decoration:none;color:#d7e1eb}
.wall-notification-row:hover{background:#152332}
.wall-notification-title{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700}
.wall-notification-body{color:#9aa9b9;font-size:11px;line-height:1.5;margin-top:4px;overflow-wrap:anywhere}
.wall-notification-new{font-size:10px;border-radius:4px;background:#314b60;color:#c3eaff;padding:2px 5px}
.wall-notification-empty{color:#9baabc;padding:14px;font-size:12px}
.wall-notification-secondary{font-size:11px;color:#dfeaf0;background:#172c3f;padding:4px 10px;border-radius:4px}
.wall-client-banner{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;min-height:38px;padding:8px 45px;margin:0 0 12px;position:relative;border-radius:8px;background:#f5c843;color:#171f26;font:650 12px/1.5 system-ui,sans-serif;text-align:center}
.wall-client-banner[hidden]{display:none!important}
.wall-client-banner[data-kind="maintenance"],.wall-client-banner[data-kind="service"]{background:#fff0bb}
.wall-client-banner[data-kind="update"]{background:#d8ebfb}
.wall-client-banner a{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.wall-client-banner button{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer}

@media(max-width:690px){.wall-notification-panel{max-height:min(390px,calc(100dvh - 20px))}}
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
 let banner=null;
 function ensureBanner(){
  if(banner)return banner;
  const wrap=document.querySelector?.('.wrap');if(!wrap)return null;
  banner=document.createElement('aside');
  banner.className='wall-client-banner';banner.id='wallClientBanner';banner.hidden=true;
  banner.setAttribute('role','status');banner.setAttribute('aria-label','Light Remote announcement');
  wrap.prepend(banner);return banner;
 }
 const clientId=/^[a-f0-9-]{36}$/i;
 const safeHref=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null}catch{return null}};
 const dismissed=id=>{try{return localStorage.getItem('lr-wall-dismissed-'+id)==='1'}catch{return false}};
 const dismiss=id=>{try{localStorage.setItem('lr-wall-dismissed-'+id,'1')}catch{}};
 function renderBanner(notices){
  if(!ensureBanner())return;
  banner.replaceChildren();
  const n=notices.find(n=>!dismissed(n.id));
  banner.hidden=!n;if(!n)return;
  banner.dataset.kind=n.kind;
  const title=document.createElement('strong');title.textContent=n.title;
  const body=document.createElement('span');body.textContent=n.message;
  banner.append(title,body);
  const link=safeHref(n.linkUrl);
  if(link){const a=document.createElement('a');a.href=link;a.textContent=n.linkLabel||'Learn more';a.target='_blank';a.rel='noopener noreferrer';banner.append(a)}
  if(n.dismissible){const b=document.createElement('button');b.type='button';b.title='Dismiss announcement';b.setAttribute('aria-label','Dismiss announcement');b.textContent='×';b.onclick=()=>{dismiss(n.id);banner.hidden=true;};banner.append(b)}
 }

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
  let accountError=false,feedError=false,system=[],announcements=[],updateNotice=null;
  let base=null,serverUnread=0;
  try{
   // Account inbox remains signed/owner-scoped; other sources cannot read it.
   try{
    const res=await fetch('/api/account-notifications',{cache:'no-store',credentials:'same-origin'});
    if(!res.ok)throw Error('notifications_unavailable');
    const data=await res.json();
    if(data.ok!==true||!Array.isArray(data.notifications))throw Error('notifications_unavailable');
    base=inboxUrl(data.accountInboxUrl);if(!base)throw Error('account_inbox_unavailable');
    all.href=base.href;
    serverUnread=Math.max(0,Math.min(9999,Number(data.unreadCount)||0));
    system=data.notifications.filter(n=>valid(n.notificationId)&&!n.readAt).slice(0,5);
   }catch{accountError=true;all.removeAttribute('href');}
   try{
    const res=await fetch('/api/client-announcements',{cache:'no-store',credentials:'same-origin'});
    if(!res.ok)throw Error('client_feed_unavailable');
    const data=await res.json();
    if(data.ok!==true||!Array.isArray(data.items))throw Error('client_feed_invalid');
    announcements=data.items.filter(n=>clientId.test(String(n.id||''))&&
      ['feature','update','maintenance','service'].includes(n.kind))
      .map(n=>({...n,id:n.id+'-'+String(n.updatedAt||'').replace(/[^a-z0-9]/gi,'').slice(0,18)}))
      .filter(n=>!dismissed(n.id));
    renderBanner(announcements);
   }catch{feedError=true;if(banner)banner.hidden=true;}
   try{
    const res=await fetch('/api/status',{cache:'no-store',credentials:'same-origin'});
    if(res.ok){
      const data=await res.json(),u=data?.local?.update||{};
      if(u.mode!=='server-managed'&&['available','ready'].includes(String(u.state||''))&&
         String(u.targetVersion||'').length>0){
       updateNotice={id:'update-'+String(u.targetVersion).slice(0,80),
        title:'Light Remote update ready',body:'Version '+String(u.targetVersion).slice(0,60)+' is available for this device.',
        href:'/settings',kind:'update'};
      }
    }
   }catch{/* Update status independently optional; never hide valid inbox alerts. */}
   const pending=announcements.filter(n=>!dismissed(n.id));
   const count=Math.min(9999,serverUnread+pending.length+(updateNotice?1:0));
   badge.hidden=count===0;badge.textContent=count>99?'99+':String(count);
   bell.setAttribute('aria-label',count?'Notifications, '+count+' unread':'Notifications');
   items.className='';items.replaceChildren();
   const add=(titleText,bodyText,href,isNew=true)=>{
    const row=document.createElement(href?'a':'div');row.className='wall-notification-row';
    if(href){row.href=href;row.target=href.startsWith('/')?'_self':'_blank';row.rel='noopener noreferrer';}
    const title=document.createElement('div');title.className='wall-notification-title';
    title.textContent=String(titleText||'Notification').slice(0,160);
    if(isNew){const label=document.createElement('span');label.className='wall-notification-new';label.textContent='New';title.append(label)}
    const body=document.createElement('div');body.className='wall-notification-body';body.textContent=String(bodyText||'').slice(0,300);
    row.append(title,body);items.append(row);
   };
   if(updateNotice)add(updateNotice.title,updateNotice.body,updateNotice.href);
   for(const n of pending.slice(0,5))add(n.title,n.message,safeHref(n.linkUrl));
   for(const n of system)if(base)add(n.title,n.body,itemLink(base,n.notificationId));
   if(!items.children.length){items.className='wall-notification-empty';items.textContent=accountError&&feedError?'Notifications temporarily unavailable.':'All caught up.';}
   else if(accountError){const p=document.createElement('div');p.className='wall-notification-empty';p.textContent='Account Inbox temporarily unavailable.';items.append(p);}
  }finally{loading=false;}
 }
 // Fixed-position, viewport-clamped placement. A right-anchored absolute
 // dropdown goes off-screen because the bell is the first toolbar control.
 function placePanel(){
  if(panel.hidden)return;
  const rect=bell.getBoundingClientRect();
  const width=panel.getBoundingClientRect().width;
  const margin=10;
  const maxLeft=Math.max(margin,window.innerWidth-width-margin);
  const left=Math.max(margin,Math.min(rect.left,maxLeft));
  const top=Math.max(margin,Math.min(rect.bottom+9,window.innerHeight-110));
  panel.style.left=Math.round(left)+'px';
  panel.style.top=Math.round(top)+'px';
  panel.style.maxHeight=Math.max(95,Math.min(390,window.innerHeight-top-margin))+'px';
 }
 function close(){panel.hidden=true;bell.setAttribute('aria-expanded','false');}
 bell.addEventListener('click',()=>{
  const opening=panel.hidden;
  panel.hidden=!opening;bell.setAttribute('aria-expanded',String(opening));
  if(opening){placePanel();void refreshNotifications();}
 });
 window.addEventListener('resize',placePanel);
 window.addEventListener('focus',()=>{void refreshNotifications();});
 window.addEventListener('scroll',placePanel,true);
 document.addEventListener('click',event=>{if(!host.contains(event.target))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshNotifications();});
 void refreshNotifications();
 setInterval(()=>{if(!document.hidden)void refreshNotifications();},60000);
})();
`;
