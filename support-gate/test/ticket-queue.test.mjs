import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ticketSummary,buildQueue} from '../src/ticket-queue.mjs';

const id='3793225f-4bcc-4ff3-9a29-ab3b16d231e7';
const conv={uuid:id,inbox_id:1,inbox_channel:'email',subject:{String:'Check Libredesk mail setup'},
 contact:{email:{String:'customer@example.com'},first_name:'Thai',last_name:'Duy'},
 last_message:{String:'Hello, this is a test'},last_message_sender:{String:'contact'},
 last_message_at:'2026-10-27T02:51:26Z',status:{String:'open'}};
test('one verified inbox has human-readable ticket identity',()=>{
 const s=ticketSummary(conv,1);
 assert.equal(s.email,'customer@example.com');
 assert.equal(s.name,'Thai Duy');
 assert.equal(s.subject,'Check Libredesk mail setup');
 assert.equal(s.last_sender,'contact');
});
test('refuses cross-brand and non-email conversations',()=>{
 assert.equal(ticketSummary({...conv,inbox_id:2},1),null);
 assert.equal(ticketSummary({...conv,inbox_channel:'livechat'},1),null);
 assert.equal(ticketSummary({...conv,uuid:'invalid'},1),null);
});
test('deduplicated queue contains one entry per conversation, sorted by latest event',()=>{
 const lookup=new Map([[id,ticketSummary(conv,1)]]);
 const out=buildQueue([{uuid:id,event_at:'2026-10-27T02:52:17Z',events:3}],lookup);
 assert.equal(out.length,1);
 assert.equal(out[0].events,3);
 assert.equal(out[0].conversation_uuid,id);
});
test('UI switches to auto-synced ticket queue, retains manual reload and blocks auto-send',()=>{
 const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(js,/syncTickets\(true\)/);
 assert.match(js,/setInterval\(.*syncTickets\(false\).*30000\)/);
 assert.match(html,/id="count-tickets"/);
 assert.match(html,/id="count-attention"/);
 assert.match(html,/id="loadTicket"/);
 assert.match(server,/if\(path==='\/api\/tickets\/queue'&&method==='GET'\)/);
 assert.match(server,/const s=await guard\(req,res,method!=='GET'\)/);
 assert.match(js,/!canSend/);
});
