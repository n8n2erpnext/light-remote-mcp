import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredRemoteInbox,verifiedTicket} from '../src/ticket-read.mjs';

const u='3793225f-4bcc-4ff3-9a29-ab3b16d231e7';
const m='402acea3-e0c5-42c2-a3e3-d7f8633cbc3a';
const make=()=>({uuid:u,inbox_id:1,inbox_channel:'email',
 contact:{email:{String:'customer@example.com'}},subject:{String:'Help needed'}});
test('requires configured positive integer inbox mapping',()=>{
 assert.equal(configuredRemoteInbox('1'),1);
 for(const x of ['','0','-1','1.5','NaN'])assert.equal(configuredRemoteInbox(x),0);
});
test('ticket import resolves recipient/subject from native conversation',()=>{
 const t=verifiedTicket(make(),[{uuid:m,type:'incoming',private:false,created_at:'2026-10-27T02:51:26Z',
 text_content:'Customer request'}],1);
 assert.equal(t.recipient,'customer@example.com');
 assert.equal(t.based_on_message_uuid,m);
 assert.equal(t.subject,'Help needed');
 assert.equal(t.brand,'light-remote');
 assert.equal(t.history.length,1);
});
test('cannot import another inbox or chat-channel ticket',()=>{
 assert.throws(()=>verifiedTicket({...make(),inbox_id:2},[],1),/ticket_not_in_remote_email_inbox/);
 assert.throws(()=>verifiedTicket({...make(),inbox_channel:'livechat'},[],1),/ticket_not_in_remote_email_inbox/);
 assert.throws(()=>verifiedTicket(make(),[],0),/ticket_not_in_remote_email_inbox/);
});
test('rejects missing contact recipient and private messages',()=>{
 assert.throws(()=>verifiedTicket({...make(),contact:{email:{String:''}}},[],1),/ticket_contact_email_unavailable/);
 const t=verifiedTicket(make(),[
  {uuid:m,type:'incoming',private:true,text_content:'internal secret',created_at:'2026-10-27T02:53:00Z'},
  {uuid:u,type:'outgoing',private:false,text_content:'Public reply',created_at:'2026-10-27T02:52:00Z'}
 ],1);
 assert.equal(t.history.length,1);
 assert.equal(t.based_on_message_uuid,u);
 assert.equal(t.history[0].text,'Public reply');
});

test('server ticket endpoint is owner-session guarded and GET-only',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/const s=await guard\(req,res,method!=='GET'\)/);
 assert.match(source,/if\(method==='GET'&&ticketMatch&&uuid\.test\(ticketMatch\[1\]\)\)/);
 assert.match(source,/return loadOwnerTicket\(req,res,ticketMatch\[1\]\)/);
 assert.match(source,/conversation\.inbox_channel!=='email'/);
 assert.match(source,/!inboxAllowed\(Number\(conversation\.inbox_id\)\)/);
 assert.match(source,/headers:\{cookie:'libredesk_session='\+cookie/);
 assert.match(ui,/async function importTicket\(conversation\)/);
 assert.match(ui,/async function syncTickets\(initial=false\)/);
 assert.doesNotMatch(source,/LIBREDESK_API_SECRET.*\/api\/tickets/);
});
