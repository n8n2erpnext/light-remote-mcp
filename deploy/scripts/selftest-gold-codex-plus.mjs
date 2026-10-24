import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createGoldCodexPlus} from '../../device-agent/gold-codex-plus.mjs';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

class FakeCodex extends EventEmitter {
  constructor(){
    super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.killed=false;
    this.auth=false;this.received=[];this._buffer='';
    this.stdin=new Writable({write:(chunk,enc,done)=>{
      this._buffer+=chunk.toString('utf8');
      let i;while((i=this._buffer.indexOf('\n'))>=0){
        const line=this._buffer.slice(0,i);this._buffer=this._buffer.slice(i+1);
        const msg=JSON.parse(line);this.received.push(msg);
        if(Object.hasOwn(msg,'id'))queueMicrotask(()=>this._handle(msg));
      }
      done();
    }});
  }
  _handle(req){
    let result=null;
    switch(req.method){
      case 'initialize':result={serverInfo:{name:'codex',version:'0.164.0'}};break;
      case 'account/read':result={requiresOpenaiAuth:true,account:this.auth?{type:'chatgpt',planType:'plus'}:null};break;
      case 'account/login/start':
        assert.deepEqual(req.params,{type:'chatgptDeviceCode'});
        result={loginId:'login-123',verificationUrl:'https://auth.openai.com/codex/device',userCode:'TEST-1234'};
        break;
      case 'account/login/cancel':result={};break;
      case 'account/logout':this.auth=false;result={};break;
      case 'thread/start':
        assert.equal(req.params.sandbox,'read-only');
        assert.equal(req.params.approvalPolicy,'never');
        assert.equal(req.params.ephemeral,true);
        result={thread:{id:'thread-123'}};break;
      case 'turn/start':
        assert.deepEqual(req.params.input[0].type,'text');
        result={turn:{id:'turn-123'}};break;
      default:throw Error('unexpected fake RPC:'+req.method);
    }
    this.stdout.write(JSON.stringify({id:req.id,result})+'\n');
    if(req.method==='turn/start')setTimeout(()=>{
      this.stdout.write(JSON.stringify({method:'item/agentMessage/delta',
        params:{delta:'Safe observer result'}})+'\n');
      this.stdout.write(JSON.stringify({method:'turn/completed',
        params:{turn:{id:'turn-123',status:'completed'}}})+'\n');
    },8);
  }
  kill(){this.killed=true;this.emit('exit',0);}
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-plus-test-'));
try {
  let fake=null;
  const client=createGoldCodexPlus({home:path.join(dir,'home'),command:process.execPath,
    spawnImpl:(binary,args,opts)=>{
      assert.ok(args.includes('app-server'));
      assert.equal(opts.env.OPENAI_API_KEY,undefined);
      assert.equal(opts.env.CODEX_API_KEY,undefined);
      assert.equal(opts.env.CODEX_ACCESS_TOKEN,undefined);
      assert.equal(opts.env.ACCESS_TOKEN,undefined);
      fake=new FakeCodex();return fake;
    }});
  assert.equal((await client.account()).connected,false);
  assert.equal(fs.statSync(path.join(dir,'home')).mode&0o077,0);
  const first=await client.beginLogin();
  assert.equal(first.userCode,'TEST-1234');
  assert.equal(first.verificationUrl,'https://auth.openai.com/codex/device');
  assert.equal(first.state,'pending');
  assert.equal((await client.beginLogin()).userCode,'TEST-1234');
  assert.equal((await client.account()).login.userCode,'TEST-1234');
  await client.cancelLogin();
  assert.equal((await client.account()).login,null);
  await client.beginLogin();
  fake.auth=true;
  fake.stdout.write(JSON.stringify({method:'account/login/completed',
    params:{loginId:'login-123',success:true}})+'\n');
  const logged=await client.account();
  assert.equal(logged.connected,true);
  assert.equal(logged.authMode,'chatgpt');
  assert.equal(logged.plan,'plus');
  assert.equal(logged.billing,'chatgpt_plan');
  const observed=await client.runReadOnly({tasks:[{title:'Check Gold',state:'todo'}]});
  assert.equal(observed.completed,true);
  assert.equal(observed.summary,'Safe observer result');
  assert.equal((await client.logout()).signedOut,true);
  assert.equal((await client.account()).connected,false);
  client.stop();
  console.log('GOLD_CODEX_PLUS_OFFICIAL_DEVICE_CODE_AUTH_AND_READONLY_RPC_PASS');

  const owner={
    enabled:true,
    identity:req=>req.headers['x-test-owner']==='yes'?{username:'existing-gold-owner'}:null,
    csrfForRequest:()=> 'test-csrf',
    verifyRequestCsrf:(_req,value)=>value==='test-csrf'
  };
  const modules=createGoldWallModules({file:path.join(dir,'gold-wall-modules.sqlite')});
  let wall=null;
  try {
    modules.configure({longMemory:true,codexBridge:true,expectedRevision:0});
    wall=startLocalWall({host:'127.0.0.1',port:0,modules,auth:owner,
      getLocalStatus:async()=>({deviceName:'Gold',cloudState:'disconnected'})});
    await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
    const base='http://127.0.0.1:'+wall.server.address().port;
    const home=await (await fetch(base+'/',{headers:{'x-test-owner':'yes'}})).text();
    assert.match(home,/Sign in with ChatGPT/);
    assert.match(home,/goldCodexPlusLogin/);
    assert.doesNotMatch(home,/id="goldCodexApiKey"/);
    assert.match(home,/Long Memory/);
    for(const [,js] of home.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))if(js.trim())new vm.Script(js);
    const permissions=await (await fetch(base+'/permissions',{headers:{'x-test-owner':'yes'}})).text();
    assert.match(permissions,/Filesystem access locations/);
    assert.equal((await fetch(base+'/api/gold/modules/codex-plus/status')).status,401);
    assert.equal((await fetch(base+'/api/gold/modules/codex-plus/login',{
      method:'POST',headers:{'x-test-owner':'yes'}})).status,403);
    assert.equal((await fetch(base+'/api/gold/modules/codex/run',{
      method:'POST',headers:{'x-test-owner':'yes','x-light-remote-csrf':'test-csrf'}})).status,410);
    console.log('GOLD_SINGLE_WALL_PLUS_AUTH_CSRF_OLD_PAID_API_DISABLED_PASS');
  }finally{if(wall)await wall.close();modules.close();}
}finally{fs.rmSync(dir,{recursive:true,force:true});}
