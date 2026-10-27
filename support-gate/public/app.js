const $=id=>document.getElementById(id);
let csrf='',current=null,canSend=false,drafts=[],filter='all',query='',toastTimer=0;

function icon(ref){return '<svg aria-hidden="true"><use href="#i-'+ref+'"></use></svg>'}
function feedback(message){
 const el=$('feedback');el.textContent=message;el.classList.add('active');
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>el.classList.remove('active'),5200);
}
async function api(path,method='GET',payload){
 const response=await fetch('/ai-support'+path,{
  method,credentials:'same-origin',
  headers:{'content-type':'application/json','x-csrf':csrf},
  body:payload===undefined?undefined:JSON.stringify(payload)
 });
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'HTTP '+response.status);
 return data;
}
function draftForm(){
 return {brand:$('brand').value,conversation_uuid:$('conversation').value.trim(),
 recipient:$('recipient').value.trim(),subject:$('subject').value.trim(),
 message:$('message').value.trim(),based_on_message_uuid:$('latest').value.trim()};
}
function relativeDate(value){
 if(!value)return 'now';
 const delta=Date.now()-new Date(value).getTime();
 if(!Number.isFinite(delta)||delta<0)return 'now';
 if(delta<60000)return 'now';
 if(delta<3600000)return Math.floor(delta/60000)+'m';
 if(delta<86400000)return Math.floor(delta/3600000)+'h';
 return new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric'});
}
function label(status){
 return ({draft:'Needs review',approved:'Approved',sent:'Sent',
   needs_review:'Recheck',unknown:'Needs attention',sending:'Sending'})[status]||status;
}
function fill(item){
 $('ticketPreview').hidden=true;
 current=item||null;
 $('editorTitle').textContent=item?item.subject:'New support draft';
 $('crumbMode').textContent=item?'Draft #'+item.id.slice(0,8):'New draft';
 $('brand').value=item?.brand||'light-remote';
 $('conversation').value=item?.conversation_uuid||'';
 $('recipient').value=item?.recipient||'';
 $('subject').value=item?.subject||'';
 $('message').value=item?.message||'';
 $('latest').value=item?.based_on_message_uuid||'';
 const status=$('draftStatus');status.textContent=item?label(item.status):'New draft';
 status.className='draft-status'+(item?.status?' '+item.status:'');
 const editable=!item||['draft','approved','needs_review'].includes(item.status);
 $('save').disabled=!editable;
 $('loadTicket').disabled=!editable;
 $('approve').disabled=!item||item.status!=='draft';
 $('send').disabled=!item||item.status!=='approved'||!canSend;
 for(const element of document.querySelectorAll('#draftForm input,#draftForm textarea,#draftForm select'))
   element.disabled=!editable;
 $('hint').textContent=item?.status==='sent'?'The reply was sent through Libredesk.':
  item?.status==='unknown'?'Delivery outcome requires manual reconciliation. Never send this draft again automatically.':
  !canSend?'Sending is locked until Libredesk agent API and inbox mappings are verified.':
  item?.status==='approved'?'Owner-approved. Check the recipient and latest message before sending.':
  'Save the proposed response, then approve it before sending.';
}
function render(){
 const target=$('drafts');target.replaceChildren();
 for(const key of ['all','draft','approved','sent']){
  $('count-'+key).textContent=key==='all'?drafts.length:drafts.filter(d=>key==='draft'?['draft','needs_review','unknown'].includes(d.status):d.status===key).length;
 }
 const visible=drafts.filter(d=>{
  if(filter==='draft'&&!['draft','needs_review','unknown'].includes(d.status))return false;
  if(filter==='approved'&&d.status!=='approved')return false;
  if(filter==='sent'&&d.status!=='sent')return false;
  const q=query.toLowerCase();
  return !q||[d.subject,d.recipient,d.brand,d.message,d.status].some(x=>String(x||'').toLowerCase().includes(q));
 });
 $('queueCount').textContent=visible.length+' '+(visible.length===1?'draft':'drafts');
 $('emptyQueue').hidden=visible.length!==0;
 for(const d of visible){
  const button=document.createElement('button');
  button.type='button';button.className='draft'+(current?.id===d.id?' active':'');button.setAttribute('role','listitem');
  const top=document.createElement('div');top.className='draft-top';
  const brand=document.createElement('span');brand.className='draft-brand'+(d.brand==='lightbi'?' bi':'');
  brand.textContent=d.brand==='lightbi'?'LightBI':'Light Remote';
  const age=document.createElement('span');age.className='draft-age';age.textContent=relativeDate(d.updated_at);
  top.append(brand,age);
  const subject=document.createElement('span');subject.className='draft-subject';subject.textContent=d.subject;
  const preview=document.createElement('span');preview.className='draft-preview';preview.textContent=d.message||'No response drafted';
  const footer=document.createElement('div');footer.className='draft-footer';
  const recipient=document.createElement('span');recipient.textContent=d.recipient;
  const pill=document.createElement('span');pill.className='pill '+d.status;pill.textContent=label(d.status);
  footer.append(recipient,pill);
  button.append(top,subject,preview,footer);
  button.addEventListener('click',()=>{fill(d);render()});
  target.append(button);
 }
}
async function refresh(){
 const result=await api('/api/drafts');
 drafts=result.drafts;
 if(current)current=drafts.find(x=>x.id===current.id)||null;
 fill(current);render();
}
async function init(){
 try{
  const session=await api('/api/session');
  csrf=session.csrf;canSend=session.outbound_ready;
  $('operator').textContent=session.email||'Admin';
  $('login').hidden=true;$('workspace').hidden=false;
  const banner=$('outbound');banner.className='info-banner'+(canSend?' ready':'');
  banner.querySelector('span').textContent=canSend
   ?'Libredesk outbound configured. Human owner approval is required before every reply.'
   :'UAT safe mode — Sending disabled until brand inboxes and Libredesk agent API are configured.';
  await refresh();
  await loadEvents().catch(()=>{});
 }catch(error){
  csrf='';canSend=false;
  $('login').hidden=false;$('workspace').hidden=true;
 }
}
function setFilter(next){
 filter=next;
 for(const item of document.querySelectorAll('[data-filter]')){
  const active=item.dataset.filter===next;
  item.classList.toggle('active',active);
  if(active)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');
 }
 $('listTitle').textContent=({all:'All drafts',draft:'Needs review',approved:'Approved',sent:'Sent'})[next]||'Drafts';
 render();
}
$('draftForm').addEventListener('submit',event=>event.preventDefault());
async function importTicket(conversation){
 if(!conversation){feedback('Paste the Libredesk conversation UUID first.');return}
 if(current&&!['draft','needs_review'].includes(current.status)){
  feedback('Create a new draft before importing another ticket.');return;
 }
 $('loadTicket').disabled=true;
 try{
  const result=await api('/api/tickets/'+encodeURIComponent(conversation));
  const ticket=result.ticket;
  $('conversation').value=ticket.conversation_uuid;
  $('brand').value='light-remote';
  $('recipient').value=ticket.recipient;
  $('subject').value=ticket.subject;
  $('latest').value=ticket.based_on_message_uuid;
  const preview=$('ticketPreview');
  preview.textContent=ticket.history.length
   ?ticket.history.slice().reverse().map(m=>m.type.toUpperCase()+': '+m.text).join('\n\n')
   :'No public messages in the latest 12-message window.';
  preview.hidden=false;
  feedback('Ticket loaded, Inbox '+ticket.inbox_id+'. Prepare and review the reply; no email was sent.');
 }catch(e){$('ticketPreview').hidden=true;feedback('Ticket not loaded: '+e.message)}
 finally{$('loadTicket').disabled=false}
}
$('loadTicket').addEventListener('click',()=>importTicket($('conversation').value.trim()));
$('retryLogin').addEventListener('click',()=>init());
$('refresh').addEventListener('click',()=>refresh().catch(e=>feedback(e.message)));
$('search').addEventListener('input',event=>{query=event.target.value.trim();render()});
document.querySelectorAll('[data-filter]').forEach(item=>
 item.addEventListener('click',()=>setFilter(item.dataset.filter)));
$('newDraft').addEventListener('click',()=>{
 if($('workspace').hidden){feedback('Sign into Libredesk first.');return}
 fill(null);render();$('subject').focus();
});
$('save').addEventListener('click',async()=>{
 try{
  const form=draftForm();
  const result=current?
    await api('/api/drafts/'+current.id,'PATCH',form):await api('/api/drafts','POST',form);
  const id=result.id||current.id;
  current={id};await refresh();
  feedback('Draft saved to Support Gate.');
 }catch(e){feedback('Save failed: '+e.message)}
});
$('approve').addEventListener('click',async()=>{
 if(!current)return;
 try{
  await api('/api/drafts/'+current.id+'/approve','POST',{version:current.version});
  feedback('Owner approval recorded.');await refresh();
 }catch(e){feedback('Approval failed: '+e.message)}
});
$('send').addEventListener('click',()=>{
 if(!current||!canSend||current.status!=='approved')return;
 $('sendConfirmText').textContent='Send the approved reply to '+current.recipient+' in its original Libredesk conversation? This will email the customer.';
 $('sendConfirm').showModal();
});
$('sendCancel').addEventListener('click',()=>$('sendConfirm').close());
$('sendProceed').addEventListener('click',async()=>{
 $('sendConfirm').close();
 if(!current||!canSend||current.status!=='approved')return;
 $('send').disabled=true;
 $('sendProceed').disabled=true;
 try{
  await api('/api/drafts/'+current.id+'/send','POST',{version:current.version});
  feedback('Reply sent through Libredesk.');await refresh();
 }catch(e){feedback('Send not completed: '+e.message);await refresh()}
 finally{$('sendProceed').disabled=false}
});
async function loadEvents(){
 const data=await api('/api/inbound/events');
 $('integrationBadge').textContent=data.webhook_connected?'Webhook connected':'Needs setup';
 $('connectWebhook').disabled=Boolean(data.webhook_connected)||!data.webhook_ready;
 $('inboundStatus').textContent='Events received: '+data.total+
  ' · Signed receiver: '+(data.webhook_ready?'ready':'not configured')+
  ' · Automatic email send: '+(data.mail_sending_ready?'configured':'disabled');
 const target=$('inboundEvents');target.replaceChildren();
 for(const event of data.events.slice(0,12)){
  const item=document.createElement('div');item.className='event-entry';
  const label=document.createElement('strong');
  label.textContent=event.event_type+(event.inbox_id?' · Inbox '+event.inbox_id:'');
  const date=document.createElement('time');date.textContent=new Date(event.received_at).toLocaleString('en-US');
  item.append(label,date);
  if(event.conversation_uuid){
   const open=document.createElement('button');open.type='button';open.className='event-import';
   open.textContent='Load ticket';open.title='Read from native Libredesk, never send email';
   open.addEventListener('click',()=>{
    if(current){fill(null);render()}
    void importTicket(event.conversation_uuid);
   });
   item.append(open);
  }
  target.append(item);
 }
}
$('connectWebhook').addEventListener('click',async()=>{
 $('connectWebhook').disabled=true;
 try{
  await api('/api/integration/connect-webhook','POST',{});
  feedback('Libredesk webhook linked to AI Support Gate.');await loadEvents();
 }catch(error){feedback('Webhook setup: '+error.message);$('connectWebhook').disabled=false}
});
$('refreshEvents').addEventListener('click',()=>loadEvents().catch(e=>feedback(e.message)));
void init();
