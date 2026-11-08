const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
import {nativeTicketStatus} from './ticket-queue.mjs';
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function value(v){return typeof v==='string'?v:typeof v?.String==='string'?v.String:''}
export function configuredRemoteInbox(envValue){
 const n=Number(envValue);
 return Number.isSafeInteger(n)&&n>0?n:0;
}
export function verifiedTicket(conversation,messages,remoteInbox,lightbiInbox=0){
 const inboxId=Number(conversation?.inbox_id);
 const brand=remoteInbox>0&&inboxId===remoteInbox?'light-remote':lightbiInbox>0&&inboxId===lightbiInbox?'lightbi':null;
 if(!conversation||!uuid.test(conversation.uuid)||!brand||conversation.inbox_channel!=='email')
  throw Error('ticket_not_in_remote_email_inbox');
 const recipient=value(conversation.contact?.email).trim().toLowerCase();
 if(!email.test(recipient)||recipient.length>256)throw Error('ticket_contact_email_unavailable');
 const list=Array.isArray(messages)?messages:[];
 const ordered=list.filter(m=>m&&uuid.test(m.uuid)&&['incoming','outgoing'].includes(m.type)&&m.private===false)
  .sort((a,b)=>Date.parse(b.created_at||0)-Date.parse(a.created_at||0));
 const latest=ordered[0]?.uuid||'';
 const history=ordered.slice(0,8).map(m=>({
  uuid:m.uuid,type:m.type,created_at:m.created_at,
  text:String(m.text_content||'').slice(0,1600)
 }));
 return {brand,conversation_uuid:conversation.uuid,status:nativeTicketStatus(conversation),
  inbox_id:inboxId,recipient,
  subject:value(conversation.subject).slice(0,240)||'Support request',
  based_on_message_uuid:latest,history,history_count:ordered.length};
}
