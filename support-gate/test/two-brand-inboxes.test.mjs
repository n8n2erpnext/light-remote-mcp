import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedTicket} from '../src/ticket-read.mjs';
import {ticketSummary} from '../src/ticket-queue.mjs';
const uuid='ad64143e-308f-403b-afc8-b08fb80cc7b2';
const msg='402acea3-e0c5-42c2-a3e3-d7f8633cbc3a';
const conv={uuid,inbox_id:2,inbox_channel:'email',contact:{email:{String:'support@thaiduy.digital'}},
 subject:{String:'LightBI Inbox UAT'},last_message_sender:{String:'contact'},
 last_message:{String:'Controlled test'}};
test('Lark Inbox 2 is recognized independently from Zoho Inbox 1',()=>{
 const t=verifiedTicket(conv,[{uuid:msg,type:'incoming',private:false,text_content:'LightBI test'}],1,2);
 assert.equal(t.brand,'lightbi');assert.equal(t.inbox_id,2);
 assert.equal(t.recipient,'support@thaiduy.digital');
 const summary=ticketSummary(conv,1,2);
 assert.equal(summary.brand,'lightbi');assert.equal(summary.inbox_id,2);
});
test('unmapped inboxes and live chat remain forbidden',()=>{
 assert.throws(()=>verifiedTicket({...conv,inbox_id:3},[],1,2),/ticket_not_in_remote_email_inbox/);
 assert.equal(ticketSummary({...conv,inbox_id:3},1,2),null);
 assert.equal(ticketSummary({...conv,inbox_channel:'livechat'},1,2),null);
 assert.throws(()=>verifiedTicket({...conv,inbox_id:0},[],0,2),/ticket_not_in_remote_email_inbox/);
});
test('AI draft remains restricted to Light Remote until LightBI AI workflow is authorized',()=>{
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(server,/Number\(conv\.inbox_id\)!==remoteInbox/);
 assert.match(ui,/ticket\.brand!=='light-remote'/);
 assert.match(ui,/AI Draft for LightBI not connected yet/);
});
