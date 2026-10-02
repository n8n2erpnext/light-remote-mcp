const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');

const root=path.resolve(__dirname,'..','..');
const operatorModule=path.join(root,'lib','operator.js');
const cryptoModule=path.join(root,'lib','operator-crypto.js');
const continuityModule=path.join(root,'lib','plus-client-continuity.cjs');

let captured=null;
require.cache[require.resolve(operatorModule)]={
  id:operatorModule,filename:operatorModule,loaded:true,
  exports:{
    callOperator:async(target,options={})=>{
      captured={target,options};
      return {ok:true,job:{jobId:'job_m6_bridge_test',status:'ok'}};
    },
    execOperator:async()=>{throw new Error('unexpected_exec_operator');}
  }
};
require.cache[require.resolve(cryptoModule)]={
  id:cryptoModule,filename:cryptoModule,loaded:true,
  exports:{sealOperatorPayload:value=>value}
};
require.cache[require.resolve(continuityModule)]={
  id:continuityModule,filename:continuityModule,loaded:true,
  exports:{
    callWithClientContinuity:async fn=>fn(),
    classifyClientCapability:()=>({reason:'selftest'}),
    clientFingerprint:()=> 'selftest'
  }
};

const handler=require(path.join(root,'api','operator.js'));
const encode=value=>Buffer.from(JSON.stringify(value),'utf8').toString('base64url');

const payload={
  deviceId:'dev_m6_bridge_test',
  operationId:'m6_bridge_run_selftest',
  sessionId:'s_m6_bridge_test_12345678',
  agentId:'agent-m6-bridge-test',
  semanticSessionId:'sem_m6_bridge_test_12345678',
  afterSeq:41,
  settleMs:90,
  displayTopologyId:'a'.repeat(64),
  events:[{type:'move',x:640,y:360}],
  await:{
    foregroundTitleContains:'ChatGPT',
    timeoutMs:1234,
    ignoredField:'must-not-cross-bridge'
  }
};

let statusCode=200,response=null;
const req={
  method:'GET',
  headers:{},
  query:{
    via:'plus',
    action:'desktop-run',
    client:'o1.client.selftest.bridge',
    p:encode(payload)
  }
};
const res={
  setHeader(){},
  status(value){statusCode=value;return this;},
  json(value){response=value;return value;}
};

(async()=>{
  await handler(req,res);
  assert.equal(statusCode,200,JSON.stringify(response));
  assert.equal(captured?.target,'/plus/client/execute');
  const body=captured?.options?.body;
  assert.equal(body?.deviceId,payload.deviceId);
  const envelope=body?.envelope;
  assert.equal(envelope?.action,'desktop');
  assert.equal(envelope?.operationId,payload.operationId);
  assert.equal(envelope?.sessionId,payload.sessionId);
  assert.equal(envelope?.agentId,payload.agentId);
  assert.equal(envelope?.desktop?.op,'run');
  assert.deepEqual(envelope?.desktop?.events,[{type:'move',x:640,y:360}]);
  assert.equal(envelope?.desktop?.displayTopologyId,payload.displayTopologyId);
  assert.equal(envelope?.desktop?.semanticSessionId,payload.semanticSessionId);
  assert.equal(envelope?.desktop?.afterSeq,41);
  assert.equal(envelope?.desktop?.settleMs,90);
  assert.deepEqual(envelope?.desktop?.await,{
    foregroundTitleContains:'ChatGPT',
    timeoutMs:1234
  });
  assert.equal(Object.hasOwn(envelope.desktop.await,'ignoredField'),false);

  const helper=require(path.join(root,'lib','plus-tool-helper.js'));
  const view=helper.toolHelperFull({
    target:{deviceId:'dev_m6_bridge_test',sessionId:payload.sessionId,agentId:payload.agentId,platform:'win32',architecture:'x64',shellModes:['default','powershell']}
  });
  assert.ok(view.tools.desktopInput.actions.includes('desktop-run'));
  assert.equal(view.tools.desktopInput.runAwait.action,'desktop-run');

  const executor=fs.readFileSync(path.join(root,'operator-host','executor.mjs'),'utf8');
  assert.ok(executor.includes("const DEVICE_CHANNEL_RM_LIVE_LIMIT = Math.max(1, Number(process.env.OPERATOR_DEVICE_CHANNEL_RM_LIVE_LIMIT || 1800));"));
  assert.ok(executor.includes("if(action==='desktop-live-push')return 'rm-live';"));
  assert.ok(executor.includes("'frame','input','run','observe'"));
  assert.ok(executor.includes("if(op==='run'){const normalized={op,...normalizeDesktopInput(request)"));
  assert.ok(executor.includes("requiredCapabilities=(op==='input'||op==='run'||op==='act')"));
  assert.ok(executor.includes("op==='run'?'Desktop run'"));

  console.log('M6_DESKTOP_RUN_BRIDGE_GATE=PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});
