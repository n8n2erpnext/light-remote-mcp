/* Admin-only notification publishing UI. All mutations checked on server. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const refs={
 form:$('notificationCompose'),type:$('notificationType'),title:$('notificationTitle'),
 body:$('notificationBody'),link:$('notificationLink'),audience:$('notificationAudience'),
 target:$('notificationTarget'),email:$('notificationTargetEmail'),
 targetWrap:$('notificationTargetWrap'),start:$('notificationStart'),end:$('notificationEnd'),
 preview:$('notificationPreview'),status:$('notificationStatus'),
 confirm:$('notificationConfirm'),rows:$('notificationRows'),total:$('notificationTotal'),
 publish:$('notificationPublish')
};
if(!refs.form)return;
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const types={update:'Product update',feature:'New feature',promotion:'Offer',maintenance:'Maintenance',security:'Security',account:'Account'};
let accounts=[],groups=[],history=[];
async function api(action,method='GET',body=null){
 const opts={method,credentials:'same-origin',cache:'no-store',headers:{accept:'application/json'}};
 if(body!==null){opts.headers['content-type']='application/json';opts.body=JSON.stringify(body)}
 const resp=await fetch('/admin/api?action='+encodeURIComponent(action),opts),data=await resp.json().catch(()=>({}));
 if(resp.status===401){location.href='/account/login';throw Error('login_required')}
 if(!resp.ok)throw Error(data.error||'notification_request_failed');
 return data;
}
function status(message,bad=false){refs.status.textContent=message;refs.status.className='setting-note '+(bad?'error':'ok')}
function audienceValue(){
 return refs.audience.value==='all'?'':refs.audience.value==='account'?refs.email.value.trim().toLowerCase():refs.target.value;
}
function renderTarget(){
 const scope=refs.audience.value;
 refs.targetWrap.classList.toggle('hide',scope==='all');
 refs.email.classList.toggle('hide',scope!=='account');
 refs.target.classList.toggle('hide',scope==='account'||scope==='all');
 const options=scope==='plan'
  ?[['free','FREE'],['pro','PRO'],['vip','VIP']]
  :scope==='group'?groups.map(x=>[x.groupId,x.name+' ('+(x.accountCount??0)+')']):[];
 refs.target.innerHTML=options.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('');
 const names={account:'Recipient email',plan:'Subscription plan',group:'Account group'};
 refs.targetWrap.firstChild.textContent=names[scope]||'Recipient';
 renderPreview();
}
function renderPreview(){
 const title=refs.title.value.trim()||'Preview title',body=refs.body.value.trim()||'Your notification will appear here.',scope=refs.audience.value;
 refs.preview.innerHTML='<small class="muted">'+esc(types[refs.type.value]||'Notification')+' · '+esc(scope==='all'?'All accounts':scope==='account'?'One email':scope==='plan'?'Plan '+audienceValue():'Group '+audienceValue())+'</small><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p><small class="muted">In-app only · No email sent</small>';
}
function when(value){if(!value)return null;const x=new Date(value).getTime();if(!Number.isFinite(x))throw Error('Invalid start or expiry date');return x}
function payload(){
 const start=when(refs.start.value),end=when(refs.end.value),scope=refs.audience.value,value=audienceValue();
 if(scope==='account'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Error('Enter a registered recipient email');
 if(scope==='group'&&!value||scope==='plan'&&!value)throw Error('Choose the audience');
 if(end!==null&&end<=Math.max(Date.now(),start||Date.now()))throw Error('Expiry must follow start time and current time');
 return {type:refs.type.value,title:refs.title.value.trim(),body:refs.body.value.trim(),
  link:refs.link.value.trim()||'/account/inbox',audienceType:scope,audienceValue:value,scheduledAt:start,expiresAt:end};
}
function renderHistory(){
 refs.total.textContent=history.length+' records';
 refs.rows.innerHTML=history.length?history.map(n=>{
  const state=n.status||'active',recipient=n.audienceType==='account'
   ?accounts.find(a=>a.account.accountId===(n.audienceValue||n.targetAccountId))?.account.email||'Specific account'
   :n.audienceType==='plan'?'Plan '+(n.audienceValue||'')
   :n.audienceType==='group'?'Group '+(groups.find(x=>x.groupId===n.audienceValue)?.name||'')
   :'All accounts';
  return '<div class="notification-history-row"><div class="notification-history-text"><strong>'+esc(n.title)+'</strong><small>'+esc(types[n.type]||n.type)+' · '+esc(recipient)+' · start '+esc(new Date(n.scheduledAt||n.createdAt).toLocaleString())+'</small>'
   +'<small>'+esc(n.body)+'</small><small>'+Number(n.readCount||0)+' account(s) marked read · '+esc(n.notificationId)+'</small></div>'
   +'<div class="notification-history-actions"><span class="badge">'+esc(state)+'</span>'
   +(['active','scheduled'].includes(state)?'<button type="button" class="btn danger" data-cancel-notice="'+esc(n.notificationId)+'">Cancel</button>':'')
   +'</div></div>';
 }).join(''):'<div class="empty">No messages published yet.</div>';
}
async function load(){
 const [notices,acc,grps]=await Promise.all([
  api('notifications'),api('accounts'),api('groups')]);
 history=notices.notifications||[];accounts=acc.accounts||[];groups=grps.groups||[];
 renderTarget();renderHistory();
}
refs.audience.addEventListener('change',renderTarget);
for(const control of [refs.type,refs.title,refs.body,refs.link,refs.email,refs.target])control.addEventListener('input',renderPreview);
refs.form.addEventListener('submit',async e=>{
 e.preventDefault();
 let body;try{body=payload()}catch(error){return status(error.message,true)}
 const description=body.audienceType==='all'?'ALL account inboxes':body.audienceType==='account'?body.audienceValue:'the selected '+body.audienceType;
 if(!confirm('Publish to '+description+'? This action creates an internal notification only; no email is sent.'))return;
 refs.publish.disabled=true;
 try{
  const out=await api('notification-publish','POST',body);
  status(out.notification?.scheduledAt>Date.now()?'Notification scheduled.':'Notification published to matching account inboxes.');
  refs.confirm.checked=false;await load();
 }catch(error){status(error.message,true)}finally{refs.publish.disabled=false}
});
$('notificationRefresh').onclick=()=>load().then(()=>status('History refreshed.')).catch(e=>status(e.message,true));
$('notificationReset').onclick=()=>{refs.form.reset();renderTarget();refs.status.textContent=''};
refs.rows.addEventListener('click',async e=>{
 const b=e.target.closest('[data-cancel-notice]');if(!b)return;
 const item=history.find(n=>n.notificationId===b.dataset.cancelNotice);
 if(!item||!confirm('Cancel "'+item.title+'"? It will disappear from recipient inboxes.'))return;
 b.disabled=true;
 try{await api('notification-cancel','POST',{notificationId:item.notificationId});await load();status('Notification canceled.')}catch(error){status(error.message,true)}finally{b.disabled=false}
});
document.querySelectorAll('.admin-nav[data-view="notification-center"]').forEach(b=>b.addEventListener('click',()=>void load().catch(e=>status(e.message,true))));
renderTarget();
})();
