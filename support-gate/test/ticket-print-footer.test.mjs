import {test} from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import {readFileSync} from 'node:fs';
import {createTicketPDF} from '../src/ticket-pdf.mjs';
import {buildPublicPage,publicHeaders,outputTimestamp} from '../src/public-ticket.mjs';

const base={uuid:'5661e50c-ea21-4f7e-bef7-29b68fdf6d5c',id:44,reference_number:900,status_id:1,subject:'Support test',created_at:'2026-10-27T01:02:00Z'};
const message={id:1,type:'incoming',created_at:'2026-10-27T01:02:00Z',text_content:'Safe sample customer message'};

test('Print page contains branded footer website, contact email and ICT print timestamp',()=>{
 for(const [inbox,email] of [[1,'support@thaiduy.digital'],[2,'support@lightbi.app']]){
  const html=buildPublicPage({...base,inbox_id:inbox},[message],{print:true});
  assert.match(html,/class="print-footer"/);
  assert.match(html,/https:\/\/support\.thaiduy\.digital\//);
  assert.ok(html.includes(email));
  assert.match(html,/Printed:.*ICT/);
  assert.doesNotMatch(html,/name="token"/);
 }
 assert.match(outputTimestamp(new Date('2026-10-27T12:34:56Z')),/19:34:56 ICT/);
});
test('PDF footer on every page has website, correct brand email, export timestamp and page number',()=>{
 const original=PDFDocument.prototype.text;
 const captured=[];
 PDFDocument.prototype.text=function(text,...rest){captured.push(String(text));return original.call(this,text,...rest);};
 try{
  for(const [inbox,email] of [[1,'support@thaiduy.digital'],[2,'support@lightbi.app']]){
   captured.length=0;
   const data=Array.from({length:50},(_,i)=>({...message,id:i+1,text_content:'Lengthy message '+i+' '.repeat(175)}));
   createTicketPDF({...base,inbox_id:inbox},data,{exportedAt:new Date('2026-10-27T12:34:56Z')});
   assert.ok(captured.includes('https://support.thaiduy.digital/'));
   assert.ok(captured.includes(email));
   assert.ok(captured.some(t=>t.includes('Exported: 27 Oct 2026, 19:34:56 ICT')));
   const pages=captured.filter(t=>/^Page \d+ \/ \d+$/.test(t));
   assert.ok(pages.length>=2);
   assert.equal(pages[0],'Page 1 / '+pages.length);
   assert.equal(pages.at(-1),'Page '+pages.length+' / '+pages.length);
  }
 }finally{PDFDocument.prototype.text=original;}
});
test('Print ready stays on the ticket page, statuses link to explanations, native print is used',()=>{
 const html=buildPublicPage({...base,inbox_id:1},[message]);
 assert.match(html,/<button[^>]+id="printReady"[^>]*>/);
 assert.doesNotMatch(html,/<a[^>]+href="[^"]+\/print"[^>]*>Print ready/);
 assert.match(html,/ticket-actions\.js/);
 assert.match(html,/href="#ticket-details"/);
 assert.match(html,/href="#status-info"/);
 assert.match(html,/aria-current="step"/);
 const script=readFileSync(new URL('../public/ticket-actions.js',import.meta.url),'utf8');
 assert.match(script,/\.print\(\)/);
 assert.match(script,/fetch\(url/);
 const css=readFileSync(new URL('../public/ticket.css',import.meta.url),'utf8');
 assert.match(css,/@bottom-right/);
 assert.match(css,/counter\(page\)/);
 assert.match(css,/counter\(pages\)/);
 for(const status of ['open','snoozed','resolved','closed'])assert.match(css,new RegExp('\\.status-tag\\.'+status+'\\{'));
 const printHeaders=publicHeaders({print:true});
 assert.equal(printHeaders['x-frame-options'],'SAMEORIGIN');
 assert.match(printHeaders['content-security-policy'],/frame-ancestors 'self'/);
});
