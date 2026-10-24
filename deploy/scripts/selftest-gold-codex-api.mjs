import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-codex-test-'));
const file=path.join(dir,'state','gold-wall-modules.sqlite');
const dummyKey='sk-test-local-not-a-real-key-123456789ABCDEF';
let callCount=0,requests=[];
function events(){
  const evt=type=>JSON.stringify({type,session_id:'sess_mock_123'});
  const chunks=[
    'data: '+evt('agent.session.created')+'\n\n',
    'data: '+JSON.stringify({type:'agent.session.turn.output_text.delta',delta:'Read-only observer response'})+'\n\n',
    'data: '+evt('agent.session.turn.completed')+'\n\n'
  ];
  return chunks.join('');
}
const mockedFetch=async(url,opts)=>{
  callCount++;requests.push({url,method:opts.method||'GET',headers:opts.headers,body:opts.body});
  assert.equal(new URL(url).origin,'https://api.openai.com');
  assert.equal(opts.headers.Authorization,'Bearer '+dummyKey);
  if(url.endsWith('/models'))return new Response(JSON.stringify({object:'list',data:[]}),{status:200,headers:{'Content-Type':'application/json'}});
  if(url.endsWith('/agents/sessions')){
    assert.equal(opts.method,'POST');
    assert.equal(opts.headers['OpenAI-Beta'],'agents=v1');
    const input=JSON.parse(opts.body);
    assert.equal(input.environment.type,'none');
    assert.equal(input.stream,true);
    assert.ok(!input.agent.tools,'No shell or MCP tools may be configured');
    assert.ok(!input.agent.mcp_servers);
    assert.match(input.input,/read-only|Observe|task/i);
    return new Response(events(),{status:200,headers:{'Content-Type':'text/event-stream'}});
  }
  throw new Error('unexpected_url');
};
let modules=createGoldWallModules({file,fetchImpl:mockedFetch}),wall;
try{
  assert.deepEqual(modules.flags(),{longMemory:false,codexBridge:false,revision:0});
  assert.equal(fs.existsSync(file),false);
  assert.throws(()=>modules.codexConfig(),/gold_module_disabled/);
  assert.throws(()=>modules.saveCodexKey({apiKey:dummyKey}),/gold_module_disabled/);
  const f=modules.configure({longMemory:false,codexBridge:true,expectedRevision:0});
  assert.equal(f.codexBridge,true);
  assert.deepEqual(modules.codexConfig(),{configured:false,model:'gpt-6-luna',
    provider:'openai_agents_api',endpoint:'api.openai.com',permission:'owner_read_only'});
  assert.throws(()=>modules.saveCodexKey({apiKey:'bad',model:'gpt-6-luna'}),/codex_api_key_invalid/);
  assert.throws(()=>modules.saveCodexKey({apiKey:dummyKey,model:'test-secret-model'}),/codex_model_not_supported/);
  const config=modules.saveCodexKey({apiKey:dummyKey,model:'gpt-6-luna'});
  assert.equal(config.configured,true);
  assert.equal(JSON.stringify(config).includes('sk-'),false);
  assert.equal(fs.statSync(file+'.codex.enc').mode&0o077,0);
  assert.equal(fs.statSync(file+'.codex.enc.key').mode&0o077,0);
  assert.ok(!fs.readFileSync(file+'.codex.enc','utf8').includes(dummyKey));
  assert.deepEqual(await modules.verifyCodexKey(),{authenticated:true,agentsApiVerified:false,model:'gpt-6-luna',provider:'openai_agents_api'});
  const task=modules.addTask({title:'Check Gold restore metadata'});
  assert.ok(task.id);
  const execution=await modules.runCodexObserver();
  assert.equal(execution.completed,true);
  assert.equal(execution.status,'completed');
  assert.equal(execution.summary,'Read-only observer response');
  assert.equal(execution.sessionId,'sess_mock_123');
  assert.equal(callCount,2);
  modules.close();
  modules=createGoldWallModules({file,fetchImpl:mockedFetch});
  assert.equal(modules.codexConfig().configured,true,'credential survives process restart');
  assert.equal((await modules.verifyCodexKey()).authenticated,true);

  const auth={
    enabled:true,
    identity:req=>req.headers['x-test-owner']==='yes'?{username:'gold-owner'}:null,
    csrfForRequest:()=> 'owned-csrf',
    verifyRequestCsrf:(_req,value)=>value==='owned-csrf'
  };
  wall=startLocalWall({host:'127.0.0.1',port:0,auth,modules,getLocalStatus:async()=>({deviceName:'Gold',cloudState:'disconnected'})});
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const base='http://127.0.0.1:'+wall.server.address().port;
  const owner={'x-test-owner':'yes'};
  const post=(url,data,headers={'x-test-owner':'yes','x-light-remote-csrf':'owned-csrf'})=>
    fetch(base+url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await fetch(base+'/api/gold/modules/codex/config')).status,401);
  assert.equal((await post('/api/gold/modules/codex/remove',{},owner)).status,403,'No mutation without CSRF');
  const page=await (await fetch(base+'/',{headers:owner})).text();
  assert.match(page,/goldCodexApiKey/);
  assert.match(page,/Run Codex observer/);
  assert.match(page,/goldMemoryArea/);
  assert.match(page,/Filesystem|Permissions|Agent A\/B access/);
  for(const [,script] of page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))if(script.trim())new vm.Script(script);
  const view=await (await fetch(base+'/api/gold/modules/codex/config',{headers:owner})).json();
  assert.equal(view.config.configured,true);
  assert.equal(JSON.stringify(view).includes(dummyKey),false);
  const viaWall=await (await post('/api/gold/modules/codex/run',{})).json();
  assert.equal(viaWall.result.completed,true);
  assert.equal((await post('/api/gold/modules/codex/remove',{})).status,200);
  assert.equal((await (await fetch(base+'/api/gold/modules/codex/config',{headers:owner})).json()).config.configured,false);
  assert.equal(fs.existsSync(file+'.codex.enc'),false);
  assert.equal((await post('/api/gold/modules/codex/run',{})).status,409);
  console.log('GOLD_CODEX_API_ENCRYPTED_KEY_OWNER_CSRF_MOCK_AGENTS_TURN_PASS');
  console.log('GOLD_CODEX_LOCAL_STATUS_AND_PAID_RUN_SEPARATION_PASS');
}finally{
  if(wall)await wall.close();
  modules.close();
  fs.rmSync(dir,{recursive:true,force:true});
}
