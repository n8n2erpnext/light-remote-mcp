import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {parseTicketPage,buildPublicPage,redactTicketText,pageNavigation,getTicketMessages,PAGE_SIZE,MAX_EXPORT_MESSAGES} from '../src/public-ticket.mjs';
import {createTicketPDF} from '../src/ticket-pdf.mjs';

const id='5661e50c-ea21-4f7e-bef7-29b68fdf6d5c';
const ticket={id:44,uuid:id,inbox_id:1,reference_number:'900',subject:'Vietnamese hỗ trợ thông tin',status_id:1,created_at:'2026-10-27T01:02:00Z'};
const rows=Array.from({length:15},(_,i)=>({id:i+1,type:i%2?'outgoing':'incoming',created_at:'2026-10-27T01:02:00Z',text_content:'Message '+(i+1)}));
test('pagination defaults to latest; explicit page is validated and bounded',()=>{
 assert.deepEqual(parseTicketPage(null,40),{page:3,pages:3,total:40});
 assert.equal(parseTicketPage('1',40).page,1);
 assert.equal(parseTicketPage('2',40).page,2);
 assert.equal(parseTicketPage('999999',40).page,3);
 assert.equal(parseTicketPage('-1',40).page,3);
 assert.equal(parseTicketPage('1 OR 1=1',40).page,3);
 assert.deepEqual(parseTicketPage(null,0),{page:1,pages:1,total:0});
});
test('HTML navigation includes First, Previous, Next, Last and aria-current',()=>{
 const html=pageNavigation(ticket,{page:2,pages:9,total:130});
 assert.match(html,/First/);assert.match(html,/Prev/);assert.match(html,/Next/);
 assert.match(html,/Last/);assert.match(html,/aria-current="page">2/);
 assert.match(html,/\?page=9/);
});
test('query filters exact stored system message IDs and paginates at PostgreSQL',async()=>{
 const queries=[];
 const pool={query:async()=>({rows:[{native_message_id:'77'}]})};
 const bridge={query:async(sql,params)=>{queries.push({sql,params});return sql.includes('COUNT')?{rows:[{total:40}]}:{rows};}};
 const page=await getTicketMessages(pool,bridge,ticket,{});
 assert.equal(page.pagination.page,3);
 assert.equal(page.total,40);assert.equal(page.messages.length,15);
 assert.equal(queries[1].params[2],PAGE_SIZE);assert.equal(queries[1].params[3],30);
 assert.match(queries[1].sql,/ORDER BY id ASC LIMIT \$3 OFFSET \$4/);
 assert.deepEqual(queries[1].params[1],['77']);
});
test('Print and PDF always query the full filtered conversation, not only latest 25',async()=>{
 const queries=[];
 const pool={query:async()=>({rows:[{native_message_id:'77'}]})};
 const bridge={query:async(sql,params)=>{queries.push(sql);return sql.includes('COUNT')?{rows:[{total:40}]}:{rows:[...rows]};}};
 const result=await getTicketMessages(pool,bridge,ticket,{all:true});
 assert.equal(result.total,40);
 assert.match(queries[1],/ORDER BY id ASC LIMIT \$3/);
 assert.doesNotMatch(queries[1],/OFFSET/);
 assert.equal(parseTicketPage(null,MAX_EXPORT_MESSAGES).pages,Math.ceil(MAX_EXPORT_MESSAGES/PAGE_SIZE));
});
test('Print-ready layout removes composer/page navigation but includes all supplied messages',()=>{
 const html=buildPublicPage(ticket,rows,{print:true,total:40});
 assert.match(html,/print-ticket.js/);
 assert.match(html,/Print now/);
 assert.match(html,/Full history/);
 assert.doesNotMatch(html,/<form method="post"/);
 assert.doesNotMatch(html,/name="token"/);
 assert.match(html,/Message 15/);
});
test('Token, code and private URL are removed from document transcripts',()=>{
 const text='See https://support.thaiduy.digital/ai-support/t/'+id+' and ticket access code: ABCD-EFGH';
 const redacted=redactTicketText(text);
 assert.doesNotMatch(redacted,/ABCD-EFGH/);
 assert.doesNotMatch(redacted,new RegExp(id));
 assert.match(redacted,/redacted/);
});
test('PDF is an actual downloadable A4 PDF with full content and does not contain private URL',async()=>{
 const messages=[{id:1,type:'incoming',created_at:'2026-10-27T01:02:00Z',text_content:'Hello Vietnamese hỗ trợ\nMessage one'}];
 const document=createTicketPDF(ticket,messages);
 const sink=new PassThrough(),buffers=[];
 sink.on('data',c=>buffers.push(c));
 document.pipe(sink);
 await new Promise((resolve,reject)=>{sink.on('end',resolve);sink.on('error',reject);document.on('error',reject);});
 const pdf=Buffer.concat(buffers);
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 assert.ok(pdf.length>6000);
 assert.match(pdf.toString('latin1'),/\/Type \/Page/);
});

test('Long transcript becomes a genuine multi-page PDF without truncating the timeline',async()=>{
 const messages=Array.from({length:50},(_,i)=>({id:i+1,type:i%2?'outgoing':'incoming',
  created_at:'2026-10-27T01:02:00Z',text_content:'Long support message '+(i+1)+' — '.repeat(20)}));
 const document=createTicketPDF(ticket,messages),sink=new PassThrough(),chunks=[];
 sink.on('data',c=>chunks.push(c));
 document.pipe(sink);
 await new Promise((resolve,reject)=>{sink.on('end',resolve);sink.on('error',reject);document.on('error',reject);});
 const raw=Buffer.concat(chunks).toString('latin1');
 const pages=(raw.match(/\/Type \/Page\b/g)||[]).length;
 assert.ok(pages>=3,'multi-page transcript should be paginated in the PDF');
});
