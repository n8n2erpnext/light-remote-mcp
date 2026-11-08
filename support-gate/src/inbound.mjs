import crypto from 'node:crypto';

const known=new Set(['conversation.created','conversation.status_changed','conversation.assigned',
 'conversation.unassigned','message.created','message.updated','webhook.test']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function trimmedUUID(value){return typeof value==='string'&&uuid.test(value)?value:null}
export function signatureFor(payload,secret){
 return 'sha256='+crypto.createHmac('sha256',secret).update(payload).digest('hex');
}
export function verifyInbound(payload,signature,secret){
 if(!secret||!signature||!/^sha256=[0-9a-f]{64}$/.test(signature))return false;
 const expected=Buffer.from(signatureFor(payload,secret));
 const supplied=Buffer.from(signature);
 return expected.length===supplied.length&&crypto.timingSafeEqual(expected,supplied);
}
export function normalizeInbound(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!known.has(raw.event))return null;
 const entity=raw.payload;
 if(!entity||typeof entity!=='object'||Array.isArray(entity))return null;
 const event=raw.event;
 const message=event.startsWith('message.');
 const inbox=Number(entity.inbox_id??entity.inbox?.id??0);
 const conversation=trimmedUUID(message
  ? (entity.conversation_uuid??entity.conversation?.uuid??entity.conversation_id)
  : entity.uuid);
 const messageId=message?trimmedUUID(entity.uuid):null;
 const sender=String(entity.sender_type??entity.sender?.type??'').slice(0,32);
 return {event,conversation_uuid:conversation,message_uuid:messageId,
  inbox_id:Number.isSafeInteger(inbox)&&inbox>0?inbox:null,sender_type:sender};
}
export function stableEventKey(normalized,rawBody){
 const name=normalized.event;
 const id=normalized.message_uuid||(name==='conversation.created'?normalized.conversation_uuid:null);
 return id?name+':'+id:name+':'+crypto.createHash('sha256').update(rawBody).digest('hex');
}
