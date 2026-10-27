const $=id=>document.getElementById(id);
let csrf='',current=null,canSend=false,aiConnected=false,drafts=[],tickets=[],filter='tickets',query='',toastTimer=0,selectedTicket=null,selectedTicketEvent=null,ticketDirty=false,syncBusy=false,syncTimer=null,manualPending=null;

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
 $('threadPanel').hidden=true;
 $('threadMessages').replaceChildren();
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
 $('sendManual').disabled=!!item||!selectedTicket||!$('latest').value||!$('message').value.trim();
 const inboxReplyMode=!!selectedTicket&&!item;
 $('save').hidden=inboxReplyMode;
 $('approve').hidden=inboxReplyMode;
 $('send').hidden=inboxReplyMode;
 $('sendManual').hidden=!inboxReplyMode;
 $('aiDraft').disabled=!aiConnected||!inboxReplyMode||!$('latest').value;
 $('aiStatus').textContent=aiConnected?'AI ready · Draft only':'AI worker not connected';
 $('ticketMetaDetails').open=!inboxReplyMode;
 $('advancedPanel').open=!inboxReplyMode;
 for(const element of document.querySelectorAll('#draftForm input,#draftForm textarea,#draftForm select'))
   element.disabled=!editable;
 $('hint').textContent=item?.status==='sent'?'The reply was sent through Libredesk.':
  item?.status==='unknown'?'Delivery outcome requires manual reconciliation. Never send this draft again automatically.':
  !canSend?'Manual replies are available from selected tickets; AI auto-send is not configured.':
  item?.status==='approved'?'Owner-approved. Check the recipient and latest message before sending.':
  'Save the proposed response, then approve it before sending.';
}
function render(){
 const target=$('drafts');target.replaceChildren();
 $('count-tickets').textContent=tickets.length;
 $('count-attention').textContent=tickets.filter(needsReply).length;
 for(const key of ['draft','approved','sent']){
  $('count-'+key).textContent=drafts.filter(d=>key==='draft'?['draft','needs_review','unknown'].includes(d.status):d.status===key).length;
 }
 if(['tickets','attention'].includes(filter)){renderTicketCards(target);return}
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
  button.addEventListener('click',()=>{selectedTicket=null;fill(d);render()});
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
  csrf=session.csrf;canSend=session.outbound_ready;aiConnected=session.ai_draft_ready===true;
  $('operator').textContent=session.email||'Admin';
  $('login').hidden=true;$('workspace').hidden=false;
  const banner=$('outbound');banner.className='info-banner'+(canSend?' ready':'');
  banner.querySelector('span').textContent=canSend
   ?'Libredesk outbound configured. Human owner approval is required before every reply.'
   :'Manual owner replies are available for connected tickets. AI automatic sending remains disabled.';
  await refresh();
  await loadEvents().catch(()=>{});
  await syncTickets(true);
  if(!syncTimer)syncTimer=setInterval(()=>{if(document.visibilityState==='visible')void syncTickets(false)},30000);
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
 $('listTitle').textContent=({tickets:'Support inbox',attention:'Needs reply',draft:'Needs review',approved:'Approved',sent:'Sent'})[next]||'Support inbox';
 render();
}
$('draftForm').addEventListener('submit',event=>event.preventDefault());
$('draftForm').addEventListener('input',()=>{ticketDirty=true});
$('aiDraft').addEventListener('click',async()=>{
 if(!aiConnected||!selectedTicket||current||$('brand').value!=='light-remote')return;
 const id=selectedTicket;
 $('aiDraft').disabled=true;
 $('aiStatus').textContent='AI is drafting…';
 try{
  const result=await api('/api/tickets/'+encodeURIComponent(id)+'/ai-draft','POST',{});
  if(selectedTicket!==id||current){feedback('AI draft created; open Needs review to inspect.');return}
  $('message').value=result.message;
  ticketDirty=true;
  $('sendManual').disabled=!$('latest').value||!$('message').value.trim();
  $('aiStatus').textContent='AI suggestion ready · Review before sending';
  await refreshDraftListOnly();
  feedback('AI draft ready. Review and edit before sending.');
 }catch(e){$('aiStatus').textContent='AI draft unavailable';feedback(e.message)}
 finally{$('aiDraft').disabled=!aiConnected||!selectedTicket||!!current||$('brand').value!=='light-remote'}
});
async function refreshDraftListOnly(){
 try{const result=await api('/api/drafts');drafts=result.drafts;render()}catch{}
}
$('message').addEventListener('input',()=>{
 $('sendManual').disabled=!!current||!selectedTicket||!$('latest').value||!$('message').value.trim();
});
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
  $('brand').value=ticket.brand;
  $('recipient').value=ticket.recipient;
  $('subject').value=ticket.subject;
  $('latest').value=ticket.based_on_message_uuid;
  const thread=$('threadMessages');thread.replaceChildren();
  for(const m of ticket.history.slice().reverse()){
   const bubble=document.createElement('article');bubble.className='thread-bubble '+(m.type==='incoming'?'incoming':'outgoing');
   const label=document.createElement('span');label.className='thread-role';label.textContent=m.type==='incoming'?'Customer':'Support';
   const body=document.createElement('p');body.textContent=m.text||'(No text body)';
   bubble.append(label,body);thread.append(bubble);
  }
  $('threadPanel').hidden=false;
  $('threadMeta').textContent=ticket.history.length+' recent messages';
  $('sendManual').disabled=!ticket.based_on_message_uuid||!$('message').value.trim();
  $('aiDraft').disabled=!aiConnected||ticket.brand!=='light-remote'||!ticket.based_on_message_uuid;
  $('aiStatus').textContent=ticket.brand==='lightbi'?'AI Draft for LightBI not connected yet':aiConnected?'AI ready · Draft only':'AI worker not connected';
  const preview=$('ticketPreview');
  preview.textContent=ticket.history.length
   ?ticket.history.slice().reverse().map(m=>m.type.toUpperCase()+': '+m.text).join('\n\n')
   :'No public messages in the latest 12-message window.';
  preview.hidden=false;
  $('editorTitle').textContent=ticket.subject;
  $('crumbMode').textContent=(ticket.brand==='lightbi'?'LightBI':'Light Remote')+' · '+ticket.recipient;
  $('draftStatus').textContent='Ready to reply';
  ticketDirty=false;
  feedback('Ticket loaded automatically. No email sent.');
 }catch(e){$('ticketPreview').hidden=true;feedback('Ticket not loaded: '+e.message)}
 finally{$('loadTicket').disabled=false}
}
$('loadTicket').addEventListener('click',()=>importTicket($('conversation').value.trim()));
$('retryLogin').addEventListener('click',()=>init());
$('refresh').addEventListener('click',()=>['tickets','attention'].includes(filter)?syncTickets(false):refresh().catch(e=>feedback(e.message)));
$('syncNow').addEventListener('click',()=>syncTickets(false));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!$('workspace').hidden)void syncTickets(false)});
$('search').addEventListener('input',event=>{query=event.target.value.trim();render()});
document.querySelectorAll('[data-filter]').forEach(item=>
 item.addEventListener('click',()=>setFilter(item.dataset.filter)));
$('newDraft').addEventListener('click',()=>{
 if($('workspace').hidden){feedback('Sign into Libredesk first.');return}
 selectedTicket=null;fill(null);setFilter('draft');$('subject').focus();
});
$('save').addEventListener('click',async()=>{
 try{
  const form=draftForm();
  const result=current?
    await api('/api/drafts/'+current.id,'PATCH',form):await api('/api/drafts','POST',form);
  const id=result.id||current.id;
  current={id};selectedTicket=null;setFilter('draft');await refresh();
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
$('sendManual').addEventListener('click',()=>{
 if(!selectedTicket||current||!$('message').value.trim()||!$('latest').value)return;
 manualPending={conversation:selectedTicket,recipient:$('recipient').value,
  baseline:$('latest').value,message:$('message').value.trim(),request_id:crypto.randomUUID()};
 $('sendConfirmText').textContent='Send this reply to '+manualPending.recipient+
  ' through the original '+($('brand').value==='lightbi'?'LightBI':'Light Remote')+' support conversation? This will email the customer.';
 $('sendConfirm').showModal();
});
$('send').addEventListener('click',()=>{
 if(!current||!canSend||current.status!=='approved')return;
 $('sendConfirmText').textContent='Send the approved reply to '+current.recipient+' in its original Libredesk conversation? This will email the customer.';
 $('sendConfirm').showModal();
});
$('sendCancel').addEventListener('click',()=>{manualPending=null;$('sendConfirm').close()});
$('sendConfirm').addEventListener('close',()=>{manualPending=null});
$('sendProceed').addEventListener('click',async()=>{
 $('sendConfirm').close();
 if(manualPending){
  const pending=manualPending;manualPending=null;
  $('sendManual').disabled=true;$('sendProceed').disabled=true;
  try{
   await api('/api/tickets/'+encodeURIComponent(pending.conversation)+'/reply','POST',{
    message:pending.message,recipient:pending.recipient,baseline:pending.baseline,request_id:pending.request_id});
   $('message').value='';
   feedback('Reply queued in Libredesk. Check delivery status in the conversation.');
   await importTicket(pending.conversation);
   await syncTickets(false);
  }catch(e){
   feedback('Reply not confirmed: '+e.message+'. Check Libredesk before trying again.');
  }finally{$('sendProceed').disabled=false}
  return;
 }
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

function needsReply(t){return ['contact','incoming'].includes(String(t.last_sender||'').toLowerCase())}
function ticketStatus(t){return needsReply(t)?'Needs reply':(['agent','outgoing','system'].includes(t.last_sender)?'Replied':'Open')}
function renderTicketCards(target){
 const list=tickets.filter(t=>(filter!=='attention'||needsReply(t))&&
  (!query||[t.subject,t.name,t.email,t.last_message,t.reference].some(v=>String(v||'').toLowerCase().includes(query.toLowerCase()))));
 $('queueCount').textContent=list.length+' '+(list.length===1?'conversation':'conversations');
 $('emptyQueue').hidden=list.length!==0;
 for(const t of list){
  const button=document.createElement('button');button.type='button';
  button.className='draft ticket-item'+(selectedTicket===t.conversation_uuid?' active':'');
  button.setAttribute('role','listitem');
  button.setAttribute('aria-label',t.name+' — '+t.subject);
  const top=document.createElement('div');top.className='draft-top';
  const brand=document.createElement('span');brand.className='draft-brand';brand.textContent=t.brand==='lightbi'?'LightBI':'Light Remote';
  if(t.brand==='lightbi')brand.classList.add('bi');
  const time=document.createElement('span');time.className='draft-age';time.textContent=relativeDate(t.last_event_at||t.updated_at);
  top.append(brand,time);
  const person=document.createElement('strong');person.className='ticket-person';person.textContent=t.name;
  const subject=document.createElement('span');subject.className='draft-subject';subject.textContent=t.subject;
  const preview=document.createElement('span');preview.className='draft-preview';preview.textContent=t.last_message||'No preview available';
  const footer=document.createElement('div');footer.className='draft-footer';
  const email=document.createElement('span');email.textContent=t.email;
  const state=document.createElement('span');state.className='pill '+(needsReply(t)?'needs_review':'sent');state.textContent=ticketStatus(t);
  footer.append(email,state);
  button.append(top,person,subject,preview,footer);
  button.addEventListener('click',()=>void selectTicket(t.conversation_uuid));
  target.append(button);
 }
}
async function selectTicket(id){
 selectedTicket=id;
 selectedTicketEvent=tickets.find(t=>t.conversation_uuid===id)?.last_event_at||null;
 ticketDirty=false;
 fill(null);
 render();
 await importTicket(id);
}
async function syncTickets(initial=false){
 if(syncBusy||$('workspace').hidden)return;
 syncBusy=true;
 $('syncStatus').textContent='Syncing…';
 try{
  const response=await api('/api/tickets/queue');
  tickets=response.tickets||[];
  const time=new Date(response.sync_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  $('syncStatus').textContent='Last synced '+time+' · Every 30 sec'+(response.unavailable?' · '+response.unavailable+' unavailable':'');
  $('queueSync').textContent='Auto-sync on';
  render();
  if(initial&&tickets.length&&!current&&!selectedTicket)await selectTicket(tickets[0].conversation_uuid);
  else if(!initial&&selectedTicket&&!current){
   const latest=tickets.find(t=>t.conversation_uuid===selectedTicket);
   if(latest?.last_event_at&&latest.last_event_at!==selectedTicketEvent){
    if(!ticketDirty){selectedTicketEvent=latest.last_event_at;await importTicket(selectedTicket)}
    else $('syncStatus').textContent='New message received · Your unsaved reply is preserved; reload when ready';
   }
  }
 }catch(e){
  $('syncStatus').textContent='Sync unavailable — retry';
  $('queueSync').textContent='Retry available';
 }finally{syncBusy=false}
}
