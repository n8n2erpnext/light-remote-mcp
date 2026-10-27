import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ticketExpiry,ticketCanView,buildPublicPage,getPublicTicket,renderPublicTicket,publicHeaders,CLOSE_GRACE_MS} from '../src/public-ticket.mjs';
import {issueReplyForm,validatePublicForm,allowPublicOrigin,submitPublicReply} from '../src/public-reply.mjs';

const id='5661e50c-ea21-4f7e-bef7-29b68fdf6d5c';
const now=Date.parse('2026-10-27T12:00:00Z');
const base={id:'8',uuid:id,inbox_id:1,reference_number:'107',subject:'UAT ticket',status_id:1,status_name:'Open',created_at:new Date(now-7200000)};
test('Open, Snoozed, Resolved remain viewable even after legacy 60-day grant expiration',()=>{
 for(const code of [1,2,3])assert.equal(ticketCanView({...base,status_id:code},new Date(now+CLOSE_GRACE_MS*100)),true);
 assert.equal(ticketExpiry(base),null);
});
test('Closed remains viewable until precisely 14 days after closed_at, then expires',()=>{
 const closed={...base,status_id:4,status_name:'Closed',closed_at:new Date(now)};
 assert.equal(ticketExpiry(closed).getTime(),now+CLOSE_GRACE_MS);
 assert.equal(ticketCanView(closed,new Date(now+CLOSE_GRACE_MS-1)),true);
 assert.equal(ticketCanView(closed,new Date(now+CLOSE_GRACE_MS)),false);
 assert.equal(ticketCanView({...closed,closed_at:null},new Date(now)),false);
});
test('Closed ticket is read-only with accurate expiry; all statuses visible',()=>{
 const t={...base,status_id:4,closed_at:new Date(now)};
 const html=buildPublicPage(t,[],{form:{requestId:id,issued:String(now),token:'a'.repeat(64)}});
 assert.match(html,/Closed/);
 assert.match(html,/14 days/);
 assert.doesNotMatch(html,/<form/);
 assert.match(html,/Open/);assert.match(html,/Snoozed/);assert.match(html,/Resolved/);
});
test('Active ticket offers plain-text-only reply form with both reply methods',()=>{
 const t={...base,subject:'<script>alert(1)</script>'};
 const html=buildPublicPage(t,[],{form:{requestId:id,issued:String(now),token:'a'.repeat(64)}});
 assert.match(html,/<form method="post"/);
 assert.match(html,/Reply to this ticket/);
 assert.match(html,/reply directly to any support email/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(publicHeaders()['content-security-policy'],/form-action 'self'/);
});
test('No grant or past closure cannot read ticket or bypass visibility',async()=>{
 const p={query:async()=>({rowCount:1,rows:[{conversation_uuid:id}]})};
 const b={query:async()=>({rowCount:1,rows:[{...base,status_id:4,closed_at:new Date(now-15*86400000)}]})};
 assert.equal(await getPublicTicket(p,b,id,new Date(now)),null);
});
test('Reply form HMAC rejects tampering and replay after 30 minutes',()=>{
 const key='k'.repeat(64),f=issueReplyForm(key,id,now);
 const input=new URLSearchParams({...f,message:'Testing contact web reply'});
 input.set('request_id',f.requestId);
 const normalized=new URLSearchParams({request_id:f.requestId,issued:f.issued,token:f.token,message:'Testing contact web reply'});
 assert.equal(validatePublicForm(key,id,normalized,now).message,'Testing contact web reply');
 normalized.set('message','<img src=x onerror=alert(1)>'); // plain text, never HTML
 assert.equal(validatePublicForm(key,id,normalized,now).message,'<img src=x onerror=alert(1)>');
 normalized.set('token','a'.repeat(64));
 assert.throws(()=>validatePublicForm(key,id,normalized,now),/invalid_form/);
 normalized.set('token',f.token);
 assert.throws(()=>validatePublicForm(key,id,normalized,now+30*60000+1),/form_expired/);
});
test('Cross-origin posts blocked, same-origin browser form permitted',()=>{
 assert.equal(allowPublicOrigin({origin:'https://support.thaiduy.digital','sec-fetch-site':'same-origin'}),true);
 assert.equal(allowPublicOrigin({origin:'https://evil.test','sec-fetch-site':'cross-site'}),false);
 assert.equal(allowPublicOrigin({}),false);
});
test('Native same-origin form POST without Origin requires exact navigation Fetch Metadata',()=>{
 const native={'sec-fetch-site':'same-origin','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
 assert.equal(allowPublicOrigin(native),true);
 assert.equal(allowPublicOrigin({...native,origin:'https://support.thaiduy.digital'}),true);
 assert.equal(allowPublicOrigin({...native,origin:'null'}),false);
 assert.equal(allowPublicOrigin({...native,origin:''}),false);
 assert.equal(allowPublicOrigin({...native,origin:'https://evil.example'}),false);
 for(const site of ['cross-site','same-site','none',undefined])assert.equal(allowPublicOrigin({...native,'sec-fetch-site':site}),false);
 for(const mode of ['cors','no-cors','same-origin',undefined])assert.equal(allowPublicOrigin({...native,'sec-fetch-mode':mode}),false);
 for(const dest of ['empty','iframe','image',undefined])assert.equal(allowPublicOrigin({...native,'sec-fetch-dest':dest}),false);
});
test('One reply request produces one narrow native contact function call and audit row',async()=>{
 const out='ad64143e-308f-403b-afc8-b08fb80cc7b2',called=[];
 const pg={connect:async()=>({query:async(sql)=>{called.push(sql);if(sql.includes('SELECT COUNT'))return {rows:[{ten:0,day:0}]};if(sql.includes('INSERT INTO support_gate_public_web_replies'))return {rowCount:1};return {}} ,release(){}}),
 query:async(sql)=>{called.push(sql);return {}}};
 const bridge={query:async(sql,vals)=>{called.push(sql);assert.equal(vals[0],id);return {rows:[{message_uuid:out}]}}};
 assert.equal(await submitPublicReply(pg,bridge,{...base},{requestId:out,message:'hello'}),out);
 assert.equal(called.filter(sql=>sql.includes('support_bridge.add_web_reply')).length,1);
 assert.equal(called.filter(sql=>sql.includes('INSERT INTO support_gate_inbound_events')).length,1);
});
