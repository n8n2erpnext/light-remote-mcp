import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signatureFor,verifyInbound,normalizeInbound,stableEventKey} from '../src/inbound.mjs';
const secret='strong-isolated-uat-key-value';
const messageId='b5f8e192-0325-4b2a-a04a-a91fca807aec',conversationId='c92e7e5d-2d84-412f-87a0-ac5898c26fae';
const obj={event:'message.created',timestamp:'2026-10-27T02:00:00Z',
 payload:{uuid:messageId,conversation_uuid:conversationId,inbox_id:1,sender_type:'contact',content:'PERSONAL INFORMATION NEVER STORE FULL BODY'}};
const body=Buffer.from(JSON.stringify(obj));
test('validates Libredesk HMAC against exact raw payload',()=>{
 const sig=signatureFor(body,secret);
 assert.match(sig,/^sha256=[0-9a-f]{64}$/);
 assert.equal(verifyInbound(body,sig,secret),true);
 assert.equal(verifyInbound(Buffer.from('tampered'),sig,secret),false);
 assert.equal(verifyInbound(body,undefined,secret),false);
 assert.equal(verifyInbound(body,sig,''),false);
 assert.equal(verifyInbound(body,'sha256='+'0'.repeat(64),secret),false);
});
test('normalizes known events to metadata only',()=>{
 const v=normalizeInbound(obj);
 assert.equal(v.event,'message.created');
 assert.equal(v.message_uuid,messageId);
 assert.equal(v.conversation_uuid,conversationId);
 assert.equal(v.inbox_id,1);
 assert.equal(JSON.stringify(v).includes('PERSONAL INFORMATION'),false);
 assert.equal(normalizeInbound({...obj,event:'invalid.event'}),null);
});
test('stable idempotency for message UUID, hash fallback for others',()=>{
 const event=normalizeInbound(obj);
 assert.equal(stableEventKey(event,body),stableEventKey(event,Buffer.from(JSON.stringify({...obj,timestamp:'later'}))));
 const conv={event:'conversation.status_changed',payload:{uuid:conversationId}};
 assert.notEqual(stableEventKey(normalizeInbound(conv),Buffer.from('a')),stableEventKey(normalizeInbound(conv),Buffer.from('b')));
});
