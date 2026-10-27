import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPublicPage,makeBridgeURL,publicHeaders,renderPublicTicket,ticketURL} from '../src/public-ticket.mjs';
const uuid='ad64143e-308f-403b-afc8-b08fb80cc7b2';
const ticket={inbox_id:2,subject:'<img src=x onerror=alert(1)>',reference_number:'104',created_at:'2026-10-27T01:01:00Z',status_id:1};
test('unpredictable UUID capability URL is exact; no sequential ticket IDs',()=>{
 assert.equal(ticketURL(uuid),'https://support.thaiduy.digital/ai-support/t/'+uuid);
 assert.throws(()=>ticketURL('104'));
});
test('public ticket uses escaped plain text and never executes customer HTML',()=>{
 const page=buildPublicPage(ticket,[{type:'incoming',created_at:'2026-10-27T01:02:00Z',text_content:'<script>alert(2)</script> Hello & bye'}]);
 assert.match(page,/&lt;script&gt;/);
 assert.doesNotMatch(page,/<script>|<img src=x/);
 assert.match(page,/LightBI Support/);
 assert.match(page,/Ticket #104/);
 assert.match(page,/No account or password/);
 assert.equal(publicHeaders()['referrer-policy'],'no-referrer');
});
test('reader verifies active grant before touching conversation history',async()=>{
 let readCalls=0;
 const denied=await renderPublicTicket({query:async()=>({rows:[],rowCount:0})},{query:async()=>{readCalls++;return {}}},uuid);
 assert.equal(denied,null);assert.equal(readCalls,0);
});
test('bridge database reuses gate credentials with only database name changed',()=>{
 assert.equal(makeBridgeURL('postgres://support_gate:pass@db:5432/support_gate'),'postgres://support_gate:pass@db:5432/libredesk');
 assert.throws(()=>makeBridgeURL('postgres://support_gate:pass@external.host/x'));
});
