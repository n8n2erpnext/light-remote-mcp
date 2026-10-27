const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const val=v=>typeof v==='string'?v:typeof v?.String==='string'?v.String:'';
export function ticketSummary(conversation,remoteInbox){
 if(!conversation||!uuid.test(conversation.uuid)||Number(conversation.inbox_id)!==remoteInbox||conversation.inbox_channel!=='email')return null;
 const c=conversation.contact||{};
 const email=val(c.email).trim().toLowerCase();
 const name=val(c.name).trim()||[val(c.first_name),val(c.last_name)].filter(Boolean).join(' ').trim()||email||'Unknown contact';
 return {conversation_uuid:conversation.uuid,inbox_id:remoteInbox,brand:'light-remote',
  name:name.slice(0,128),email:email.slice(0,256),
  subject:val(conversation.subject).slice(0,240)||'No subject',
  status:val(conversation.status)||'open',
  last_message:val(conversation.last_message).slice(0,200),
  last_sender:val(conversation.last_message_sender).toLowerCase(),
  updated_at:conversation.last_message_at?.Time||conversation.last_message_at||conversation.updated_at||null,
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
