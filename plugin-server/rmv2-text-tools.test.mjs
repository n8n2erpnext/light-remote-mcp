import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {registerPluginTools} from './tools.mjs';
import {AccountOperatorAdapter} from './operator-adapter.mjs';

function fixture(scopes=['remote:execute','remote:read']){
  const tools=new Map();
  registerPluginTools({registerTool(name,config,call){assert.equal(tools.has(name),false);tools.set(name,{config,call});}},
    {accountId:'account',clientId:'client',scopes});
  return tools;
}
test('named Windows typing tools expose complete logical input and governed progress/cancel',async t=>{
  const calls=[],original=AccountOperatorAdapter.prototype.desktop;
  AccountOperatorAdapter.prototype.desktop=async function(...args){calls.push(args);return {ok:true,data:{writeId:'write_abcdefgh',state:'running'}};};
  t.after(()=>{AccountOperatorAdapter.prototype.desktop=original;});
  const tools=fixture(),write=tools.get('light_remote_desktop_write_text');
  const input={sessionId:'session',desktopSessionId:'desk_abcdefgh',text:'x'.repeat(65536),verification:'required'};
  assert.equal(z.object(write.config.inputSchema).parse(input).text.length,65536);
  const result=await write.call(input);assert.equal(result.structuredContent.ok,true);
  assert.equal(calls[0][1].op,'text-write-start');assert.equal(calls[0][1].text.length,65536);
  await tools.get('light_remote_desktop_type_text').call({...input,text:'Unicode '+String.fromCodePoint(0x1f600)});
  assert.equal(calls[1][1].typingKind,'type');
  await tools.get('light_remote_desktop_text_status').call({sessionId:'session',writeId:'write_abcdefgh'});
  assert.equal(calls[2][1].op,'text-write-status');
  await tools.get('light_remote_desktop_text_cancel').call({sessionId:'session',writeId:'write_abcdefgh'});
  assert.equal(calls[3][1].op,'text-write-cancel');
});
test('pinned source requires read OAuth in addition to execute before dispatch',async t=>{
  let calls=0;const original=AccountOperatorAdapter.prototype.desktop;
  AccountOperatorAdapter.prototype.desktop=async()=>{calls++;return {ok:true,data:{}};};
  t.after(()=>{AccountOperatorAdapter.prototype.desktop=original;});
  const input={sessionId:'session',desktopSessionId:'desk_abcdefgh',sourcePath:'/allowed/text',sourceSha256:'a'.repeat(64)};
  const denied=await fixture(['remote:execute']).get('light_remote_desktop_write_text').call(input);
  assert.equal(denied.isError,true);assert.equal(calls,0);
  await fixture().get('light_remote_desktop_write_text').call(input);assert.equal(calls,1);
});
