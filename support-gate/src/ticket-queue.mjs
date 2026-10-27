const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const val=v=>typeof v==='string'?v:typeof v?.String==='string'?v.String:'';
const statusById={1:'open',2:'snoozed',3:'resolved',4:'closed'};
export function nativeTicketStatus(conversation){
 const id=Number(conversation?.status_id);
 if(statusById[id])return statusById[id];
 const raw=val(conversation?.status).toLowerCase().trim();
 return ['open','snoozed','resolved','closed'].includes(raw)?raw:'unknown';
}
export function ticketSummary(conversation,remoteInbox,lightbiInbox=0){
 const inboxId=Number(conversation?.inbox_id);
 const brand=remoteInbox>0&&inboxId===remoteInbox?'light-remote':lightbiInbox>0&&inboxId===lightbiInbox?'lightbi':null;
 if(!conversation||!uuid.test(conversation.uuid)||!brand||conversation.inbox_channel!=='email')return null;
 const c=conversation.contact||{};
 const email=val(c.email).trim().toLowerCase();
 const name=val(c.name).trim()||[val(c.first_name),val(c.last_name)].filter(Boolean).join(' ').trim()||email||'Unknown contact';
 return {conversation_uuid:conversation.uuid,inbox_id:inboxId,brand,
  name:name.slice(0,128),email:email.slice(0,256),
  subject:val(conversation.subject).slice(0,240)||'No subject',
  status:nativeTicketStatus(conversation),status_id:Number(conversation.status_id)||null,
  last_message:val(conversation.last_message).slice(0,200),
  last_sender:val(conversation.last_message_sender).toLowerCase(),
  updated_at:conversation.last_message_at?.Time||conversation.last_message_at||conversation.updated_at||null,
  status_updated_at:conversation.updated_at||null,
  reference:val(conversation.reference_number).slice(0,35)};
}
export function buildQueue(events,byUUID){
 const out=[];
 for(const e of events){
  const summary=byUUID.get(e.uuid);
  if(summary)out.push({...summary,last_event_at:e.event_at,events:Number(e.events)||1});
 }
 return out.sort((a,b)=>Date.parse(b.last_event_at||0)-Date.parse(a.last_event_at||0));
}
