import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeMemoryRequest } from './gold-memory-operation.mjs';
import { createGoldWallModules } from './gold-wall-modules.mjs';
import { startLocalWall } from './local-wall.mjs';

test('paired Wall auto-capture replaces browser context without changing signed checkpoints', async () => {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, 'lr-browser-memory-'));
  const identity = { accountId:'owner:fixture', deviceId:'browser-home' };
  const modules = createGoldWallModules({file:path.join(root,'memory.sqlite'),scopeIdentity:identity});
  const owner = {'x-test-owner':'yes'};
  const auth = {enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?{username:'owner'}:null,
    csrfForRequest:()=> 'fixture-csrf',verifyRequestCsrf:(_req,token)=>token==='fixture-csrf'};
  let wall;
  try {
    modules.configure({longMemory:true,codexBridge:false,expectedRevision:0});
    const {scopeId} = modules.createMemoryScope({displayName:'Writing project'});
    modules.appendScopedCheckpoint({scopeId,title:'Working notes',body:'Manual notes',source:'owner'});
    const handoffBefore = modules.scopedHandoff({scopeId});
    wall = startLocalWall({host:'127.0.0.1',port:0,modules,auth,getLocalStatus:async()=>({cloudState:'disconnected'})});
    if (!wall.server.listening) await once(wall.server,'listening');
    const base = 'http://127.0.0.1:'+wall.server.address().port+'/api/gold/modules';
    const endpoint = base+'/browser-context';
    const getContext = () => fetch(base+'/scope/browser-context?scopeId='+scopeId,{headers:owner}).then(response=>response.json());
    const post = (payload,headers={'x-light-remote-csrf':'fixture-csrf'}) => fetch(endpoint,{
      method:'POST',headers:{...owner,'content-type':'application/json',...headers},body:JSON.stringify(payload)
    });
    const binding = {...identity,scopeId,conversationUrl:'https://chatgpt.com/c/fixture-conversation'};
    const start = {...binding,action:'start',ownerConfirmed:true};
    assert.equal((await fetch(endpoint+'/targets')).status,401);
    const targets = await (await fetch(endpoint+'/targets',{headers:owner})).json();
    assert.deepEqual(targets,{ok:true,...identity,scopes:[{scopeId,displayName:'Writing project'}],csrf:'fixture-csrf'});
    assert.equal((await post(start,{})).status,403);
    assert.equal((await post({...start,ownerConfirmed:false})).status,403);
    assert.equal((await post({...start,deviceId:'unpaired-device'})).status,403);
    assert.equal((await post({...start,conversationUrl:binding.conversationUrl+'?private=1'})).status,400);
    const started = await (await post(start)).json();
    assert.equal(started.ok,true);
    assert.equal((await getContext()).context.available,false);
    const save = (text,watchId=started.watchId) => ({...binding,action:'save',watchId,text,
      sha256:createHash('sha256').update(text).digest('hex')});
    const first = save('Một câu hỏi');
    assert.equal((await post({...first,sha256:'bad'})).status,400);
    const saved = await (await post(first)).json();
    assert.equal(saved.changed,true);
    const dup = await (await post(first)).json();
    assert.equal(dup.changed,false);
    assert.equal(dup.savedAt,saved.savedAt);
    const latest = save('Một câu hỏi\n\nCâu trả lời');
    assert.equal((await (await post(latest)).json()).changed,true);
    assert.equal((await getContext()).context.text,latest.text);
    const read = executeMemoryRequest(modules,{action:'scope_browser_context',scopeId,offset:3,maxChars:7});
    assert.equal(read.source,'auto_captured_browser_history');
    assert.equal(read.sha256,latest.sha256);
    assert.equal(read.text,latest.text.slice(3,10));
    assert.deepEqual(modules.scopedHandoff({scopeId}),handoffBefore);
    assert.equal((await post({...binding,action:'stop',watchId:started.watchId})).status,200);
    assert.equal((await post(save('Late delivery'))).status,409);
    const restarted = await (await post(start)).json();
    assert.notEqual(restarted.watchId,started.watchId);
    assert.equal((await getContext()).context.text,latest.text);
    assert.equal((await post(save('Previous watch',started.watchId))).status,409);
    modules.deleteMemoryScopeLocal({scopeId,ownerConfirmed:true,confirmName:'Writing project'});
    assert.equal((await getContext()).context.available,false);
    assert.deepEqual((await (await fetch(endpoint+'/targets',{headers:owner})).json()).scopes,[]);
  } finally {
    if (wall?.server.listening) await new Promise(resolve=>wall.server.close(resolve));
    modules.close();
    if (path.dirname(await realpath(root))===temp) await rm(root,{recursive:true,force:true});
  }
});
