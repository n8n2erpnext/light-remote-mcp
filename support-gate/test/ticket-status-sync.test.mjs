import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeTicketStatus,ticketSummary,buildQueue} from '../src/ticket-queue.mjs';
import {verifiedTicket} from '../src/ticket-read.mjs';

const id='3793225f-4bcc-4ff3-9a29-ab3b16d231e7';
const conv={
 uuid:id,inbox_id:1,inbox_channel:'email',subject:'UAT ticket',
 contact:{email:'customer@example.test'},last_message_sender:'contact',
 last_message:'Please assist',last_message_at:'2026-10-27T12:00:00Z',
 status:'Closed',status_category:'resolved',status_id:4,
 updated_at:'2026-10-27T13:00:00Z'
};
test('Libredesk Closed is authoritative despite last customer sender and resolved category',()=>{
 assert.equal(nativeTicketStatus(conv),'closed');
 assert.equal(ticketSummary(conv,1,2).status,'closed');
 assert.equal(ticketSummary(conv,1,2).status_id,4);
 assert.equal(ticketSummary(conv,1,2).status_updated_at,conv.updated_at);
 const read=verifiedTicket(conv,[],1,2);
 assert.equal(read.status,'closed');
});
test('Open/Snoozed/Resolved/Closed are normalized from native IDs and native strings',()=>{
 for(const [id,name] of [[1,'open'],[2,'snoozed'],[3,'resolved'],[4,'closed']]){
  assert.equal(nativeTicketStatus({...conv,status_id:id,status:'strange'}),name);
  assert.equal(nativeTicketStatus({...conv,status_id:null,status:name.toUpperCase()}),name);
 }
 assert.equal(nativeTicketStatus({...conv,status_id:null,status:'nonexistent'}),'unknown');
});
test('Queue retains six Closed records for archival instead of deleting customer history',()=>{
 const records=Array.from({length:18},(_,i)=>({
  ...conv,uuid:'3793225f-4bcc-4ff3-9a29-'+(0xab3b16d231e7+i).toString(16).padStart(12,'0'),
  status_id:i<12?1:4,status:i<12?'Open':'Closed'
 }));
 const byUUID=new Map(records.map(x=>[x.uuid,ticketSummary(x,1,2)]));
 const events=records.map((x,i)=>({uuid:x.uuid,event_at:'2026-10-27T13:00:00Z',events:1}));
 const all=buildQueue(events,byUUID);
 assert.equal(all.length,18);
 assert.equal(all.filter(t=>t.status==='open').length,12);
 assert.equal(all.filter(t=>t.status==='closed').length,6);
});
test('AI Support UI correctly separates active/closed, needs reply, and forbids closed replies',()=>{
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(html,/data-filter="closed"/);
 assert.match(html,/id="count-closed"/);
 assert.match(ui,/function isClosed\(t\)/);
 assert.match(ui,/filter==='closed'\?isClosed\(t\):!isClosed\(t\)/);
 assert.match(ui,/!isClosed\(t\)&&\['contact','incoming'\]/);
 assert.match(ui,/latest\.status!==selectedTicketStatus/);
 assert.match(ui,/selectedIsClosed\(\)/);
 const denied=(server.match(/ticket_closed_read_only/g)||[]).length;
 assert.ok(denied>=3,'manual reply, draft generation and sending are all guarded');
});
test('Send reply button has margin and is right aligned below textarea on the public ticket',()=>{
 const css=readFileSync(new URL('../public/ticket.css',import.meta.url),'utf8');
 assert.match(css,/\.reply form button\[type="submit"\]\{align-self:flex-end;margin-top:18px/);
});
