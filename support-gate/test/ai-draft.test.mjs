import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aiProviderReady,boundedPrompt,checkedDraft,requestAIDraft} from '../src/ai-draft.mjs';
const ticket={brand:'light-remote',inbox_id:1,recipient:'tester@example.com',subject:'Support request',
 history:[{type:'incoming',text:'Please help',uuid:'3793225f-4bcc-4ff3-9a29-ab3b16d231e7'}]};
const config={url:'http://10.192.135.61:8099/v1/draft',token:'x'.repeat(96)};
test('AI provider is pinned to private Gold UAT address and requires private token',()=>{
 assert.equal(aiProviderReady(config),true);
 assert.equal(aiProviderReady({...config,url:'https://evil.example/v1/draft'}),false);
 assert.equal(aiProviderReady({...config,url:'http://10.192.135.61:8099/other'}),false);
 assert.equal(aiProviderReady({...config,url:'http://127.0.0.1:8099/v1/draft'}),false);
 assert.equal(aiProviderReady({...config,token:'short'}),false);
});
test('only Light Remote email ticket content can be sent to AI',()=>{
 assert.deepEqual(boundedPrompt(ticket).history,[{role:'customer',text:'Please help'}]);
 assert.throws(()=>boundedPrompt({...ticket,brand:'lightbi'}),/ai_ticket_scope_denied/);
 assert.throws(()=>boundedPrompt({...ticket,inbox_id:2}),/ai_ticket_scope_denied/);
 assert.throws(()=>boundedPrompt({...ticket,history:[]}),/no_customer_message_for_ai/);
});
test('rejects empty, overlong and possible leaked credential outputs',()=>{
 assert.equal(checkedDraft({message:' Hello '}) ,'Hello');
 assert.throws(()=>checkedDraft({message:''}),/ai_response_invalid/);
 assert.throws(()=>checkedDraft({message:'a'.repeat(6001)}),/ai_response_invalid/);
 assert.throws(()=>checkedDraft({message:'password=abcdef1234'}),/ai_response_sensitive/);
});
test('AI draft adapter cannot request sending and returns bounded text',async()=>{
 let captured=null;
 const text=await requestAIDraft({...config,ticket,fetchImpl:async(url,options)=>{
  captured={url,payload:JSON.parse(options.body)};
  return {ok:true,json:async()=>({message:'Thanks! Could you share the app version?'})};
 }});
 assert.match(text,/Thanks/);
 assert.equal(captured.payload.operation,'draft_support_reply_v1');
 assert.equal(JSON.stringify(captured.payload).includes('send_mail'),false);
});
test('AI draft route is owner-protected POST; UI keeps review/send distinct',()=>{
 const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const frontend=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/const s=await guard\(req,res,method!=='GET'\)/);
 assert.match(source,/method==='POST'&&aiDraftMatch/);
 assert.match(source,/return ownerCreateAIDraft/);
 assert.match(source,/conversation_changed_during_ai_generation/);
 assert.match(source,/ai_draft_ready:aiReady\(\)/);
 assert.match(frontend,/id\)\+'\/ai-draft'/);
 assert.match(frontend,/AI draft ready/);
});
