import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createOperatorCryptoFixture} from '../../deploy/scripts/selftest-crypto-fixture.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';

// Real Operator + real Agent executable over a strictly loopback-only bridge.
// Uses disposable keys, account, UAT process, Unix socket and Agent local Wall.
// This is NOT a production Agent rollout or a global writer-epoch proof.
test('actual Agent binary signed process-start ACK precedes OS exit; remote WAL must remain unresolved',
  {timeout:45000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-real-agent-wal-'));
  const cwd=fileURLToPath(new URL('../../',import.meta.url));
  const operatorEntry=path.join(cwd,'operator-host','executor.mjs');
  const agentEntry=path.join(cwd,'device-agent','operator-agent.mjs');
  for(const sub of ['state','log','socket','freeze','agent'])
    fs.mkdirSync(path.join(root,sub),{mode:0o700});
  const socketPath=path.join(root,'socket','operator.sock');
  const journalPath=path.join(root,'state','dev-remote-effects.json');
  const markerPath=path.join(root,'freeze','freeze.json');
  const agentStateFile=path.join(root,'agent','device.json');
  const commandDir=path.join(root,'agent','commands');
  durableAtomicWriteSync(journalPath,JSON.stringify({schemaVersion:1,pending:[]})+'\n',{mode:0o600});
  const fixture=createOperatorCryptoFixture(path.join(root,'state'));
  const baseEnv={
    PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,LANG:'C',
    NODE_ENV:'test',LIGHT_REMOTE_VERSION:'0.9.0-rc.50'
  };
  const operatorEnv={...baseEnv,
    OPERATOR_SOCKET:socketPath,OPERATOR_LOG_DIR:path.join(root,'log'),
    OPERATOR_STATE_DIR:path.join(root,'state'),
    OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_ACCOUNT_ID:'self-hosted-local',
    OPERATOR_DEVICE_ID:'uat_hub',OPERATOR_NODE_ID:'uat_hub',
    OPERATOR_INTEGRATED_HOST:'0',OPERATOR_CONNECTION_LEASE_ENFORCE:'1',
    OPERATOR_FLEET_CHANNEL_TTL_MS:'5000',OPERATOR_FLEET_COMMAND_LEASE_MS:'3000',
    LR_RC50_DEV_LOCAL_FREEZE:'1',
    LR_RC50_OPERATOR_FREEZE_MARKER_PATH:markerPath,
    LR_RC50_DEV_REMOTE_EFFECT_JOURNAL:'1',
    LR_RC50_DEV_REMOTE_EFFECT_JOURNAL_PATH:journalPath
  };
  const operatorChild=spawn(process.execPath,[operatorEntry],{
    cwd,env:operatorEnv,stdio:['ignore','pipe','pipe']});
  let operatorStderr='',agentStderr='';
  operatorChild.stderr.on('data',v=>{operatorStderr=(operatorStderr+v).slice(-4000);});
  let agentChild=null,bridge=null,childProcessId=null,childOsPid=null;
  const resultReceipts=[];
  const request=(method,target,body)=>new Promise((resolve,reject)=>{
    const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
    const req=http.request({socketPath,method,path:target,timeout:5000,
      headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}
    },res=>{
      let raw='';res.on('data',d=>raw+=d);res.on('end',()=>{
        try{resolve({status:res.statusCode,data:JSON.parse(raw)});}
        catch{resolve({status:res.statusCode,data:{raw}});}
      });
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('operator_http_timeout')));
    if(bytes)req.write(bytes);
    req.end();
  });
  const until=async(check,ms=12000)=>{
    for(let i=0;i<Math.ceil(ms/70);i++){
      const result=await Promise.resolve().then(check).catch(()=>null);
      if(result)return result;
      await sleep(70);
    }
    throw Error('real_agent_uat_timeout '+operatorStderr.slice(-600)+' '+agentStderr.slice(-600));
  };
  const journal=()=>JSON.parse(fs.readFileSync(journalPath,'utf8'));
  const kp=crypto.generateKeyPairSync('ed25519');
  const pub=kp.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const priv=kp.privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
  let deviceId='';
  const sign=(action,payload)=>{
    const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');
    const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({
      deviceId,action,timestamp,nonce,payload
    })),kp.privateKey).toString('base64url');
    return {deviceId,timestamp,nonce,signature,payload};
  };
  async function stop(child){
    if(!child||child.exitCode!==null||child.signalCode!==null)return;
    child.kill('SIGTERM');
    const timeout=new AbortController();
    try{
      await Promise.race([
        new Promise(resolve=>child.once('exit',resolve)),
        sleep(5000,null,{signal:timeout.signal}).then(()=>{throw Error('uat_stop_timeout');})
      ]);
    }catch{child.kill('SIGKILL');await sleep(100);}
    finally{timeout.abort();}
  }
  try{
    await until(async()=>fs.existsSync(socketPath)&&
      (await request('GET','/healthz')).status===200);
    const begun=await request('POST','/v1/enrollments/begin',{
      publicIdentityKey:pub,displayName:'Real Disposable Agent',
      platform:'linux',architecture:process.arch,agentVersion:'0.9.0-rc.50',
      fingerprintSummary:'local-uat-only',capabilities:['filesystem'],
      policyProfile:'uat'});
    assert.equal(begun.status,200,JSON.stringify(begun.data));
    const approved=await request('POST','/v1/enrollments/approve',{
      code:begun.data.enrollment.deviceCode,accountId:'self-hosted-local',
      approvedCapabilities:['filesystem'],policyProfile:'uat'});
    assert.equal(approved.status,200,JSON.stringify(approved.data));
    deviceId=approved.data.approval.deviceId;
    const signedConnect=await request('POST','/v1/device-channel/connect',sign('connect',{
      nodeId:deviceId,agentVersion:'0.9.0-rc.50',
      requestedLeaseMs:3600000,reconnectGraceMs:1800000
    }));
    assert.equal(signedConnect.status,200,JSON.stringify(signedConnect.data));
    // Construct ONLY a fake local Agent state with the same crypto identity
    // enrolled above. No keys or state are copied from real user installations.
    const now=Date.now();
    const agentState={
      identity:{algorithm:'Ed25519',privateKey:priv,publicIdentityKey:pub,
        publicKeySha256:crypto.createHash('sha256').update(Buffer.from(pub,'base64')).digest('hex'),
        createdAt:now},
      enrollment:{deviceId,nodeId:deviceId,accountId:'self-hosted-local',
        approvedCapabilities:['filesystem'],grantableCapabilities:['filesystem'],
        policyProfile:'uat',enrolledAt:now},
      policy:{serverPolicyRevision:1,localFinalDenyBoundary:true,deniedCapabilities:[]},
      effectiveCapabilities:['filesystem'],
      cloud:{desiredConnected:true,state:'connected',plan:'free',
        connectedAt:now,lastRenewedAt:now,hardExpiresAt:now+3600000}
    };
    fs.writeFileSync(agentStateFile,JSON.stringify(agentState)+'\n',{mode:0o600});
    // Only exposes 127.0.0.1 ephemeral port; forwards a strict allowlist
    // of Agent channel operations to THIS disposable Operator Unix socket.
    bridge=http.createServer(async(req,res)=>{
      const target=String(req.url||'');
      if(req.method!=='POST'||!/^\/device-channel\/(poll|result|fleet-intent|update-report)$/.test(target)){
        res.writeHead(404,{'content-type':'application/json'});
        res.end(JSON.stringify({ok:false,error:'local_uat_bridge_not_found'}));return;
      }
      let raw='';
      for await(const chunk of req)raw+=chunk;
      const pathName='/v1'+target;
      const upstream=http.request({socketPath,path:pathName,method:'POST',
        headers:{'content-type':'application/json','content-length':Buffer.byteLength(raw)}
      },reply=>{
        let body='';reply.on('data',d=>body+=d);
        reply.on('end',()=>{
          if(target==='/device-channel/result'&&reply.statusCode===200){
            try{const b=JSON.parse(raw),accepted=JSON.parse(body);
              if(accepted.accepted)resultReceipts.push({signed:b,accepted});
            }catch{}
          }
          res.writeHead(reply.statusCode,{'content-type':'application/json'});
          res.end(body);
        });
      });
      upstream.on('error',error=>{
        res.writeHead(502,{'content-type':'application/json'});
        res.end(JSON.stringify({ok:false,error:'uat_upstream_unavailable'}));
      });
      upstream.end(raw);
    });
    await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+bridge.address().port;
    const portReservation=http.createServer();
    await new Promise(resolve=>portReservation.listen(0,'127.0.0.1',resolve));
    const wallPort=portReservation.address().port;
    await new Promise(resolve=>portReservation.close(resolve));
    const agentEnv={...baseEnv,
      OPERATOR_AGENT_STATE:agentStateFile,
      OPERATOR_AGENT_COMMAND_DIR:commandDir,
      OPERATOR_AGENT_BASE_URL:base,OPERATOR_AGENT_HUB_URL:base,
      OPERATOR_AGENT_WALL_PORT:String(wallPort),
      OPERATOR_AGENT_WALL_HOST:'127.0.0.1',
      OPERATOR_AGENT_CHANNEL_WAIT_MS:'1000',
      OPERATOR_AGENT_MAX_WORKERS:'1',
      OPERATOR_FLEET_RECONCILE_MS:'300000',
      LIGHT_REMOTE_UPDATE_MODE:'server-managed',
      LIGHT_REMOTE_ANNOUNCEMENTS_FILE:path.join(root,'agent','announcements.json')
    };
    agentChild=spawn(process.execPath,[agentEntry,'daemon'],{
      cwd,env:agentEnv,stdio:['ignore','pipe','pipe']});
    agentChild.stderr.on('data',d=>{agentStderr=(agentStderr+d).slice(-4000);});
    await until(async()=>{
      if(agentChild.exitCode!==null)throw Error('agent_early_exit '+agentStderr);
      const fleet=await request('GET','/v1/fleet');
      return fleet.data.nodes?.some(x=>x.nodeId===deviceId&&x.state==='online');
    });
    const agentId='uat-real-agent-owner-abcdefgh';
    const opened=await request('POST','/v1/sessions/open',{
      agentId,nodeId:deviceId,openId:'open-real-agent-fleet-abcdefgh',
      label:'real Agent isolate',workspace:root,gracePreset:'30m'});
    assert.equal(opened.status,200,JSON.stringify(opened.data));
    const sessionId=opened.data.session.sessionId;
    const makeRequest=async(op,processRequest)=>{
      const operationId='uat-real-agent-'+op+'-'+crypto.randomBytes(8).toString('hex');
      const envelope=fixture.seal({
        action:'process',operationId,sessionId,agentId,nodeId:deviceId,
        process:processRequest,waitMs:1
      });
      const response=await request('POST','/v1/process',envelope);
      assert.equal(response.status,200,JSON.stringify(response.data));
      const commandId=response.data.job.commandId;
      assert.ok(commandId,'must dispatch actual Fleet command');
      const receipt=await until(()=>resultReceipts.find(x=>x.signed.payload?.commandId===commandId));
      assert.equal(receipt.accepted.duplicate,false);
      assert.equal(receipt.signed.payload.status,'ok',JSON.stringify(receipt.signed.payload));
      return {commandId,payload:receipt.signed.payload};
    };
    const started=await makeRequest('start',{op:'start',script:'exec /bin/sleep 12',cwd:root,
      timeoutMs:15000});
    assert.equal(started.payload.data?.operation,'start');
    childProcessId=started.payload.data?.process?.processId;
    childOsPid=started.payload.data?.process?.pid;
    assert.ok(childProcessId&&Number.isSafeInteger(childOsPid)&&childOsPid>0,
      'Agent must return actual process registry ID and OS PID');
    const persisted=JSON.parse(fs.readFileSync(path.join(commandDir,started.commandId+'.json'),'utf8'));
    assert.equal(persisted.state,'finished',
      'the Agent has ACKed only command execution, not the OS process lifetime');
    assert.equal(journal().pending.length,1);
    const listed=await makeRequest('list',{op:'list'});
    const active=listed.payload.data?.processes?.find(row=>row.processId===childProcessId);
    assert.ok(active&&!active.finishedAt,
      'actual Agent NativeProcessRegistry must still report running OS child AFTER signed ACK');
    assert.equal(journal().pending.length,2);
    // Stop the disposable UAT child via a THIRD actual signed Agent command.
    const stopped=await makeRequest('stop',{op:'stop',processId:childProcessId,force:true});
    assert.equal(stopped.payload.data?.operation,'stop');
    await until(async()=>{
      const list=await makeRequest('verify',{op:'list'});
      return list.payload.data?.processes?.some(row=>row.processId===childProcessId&&row.finishedAt);
    },9000);
    assert.ok(journal().pending.length>=4,
      'even a known test-only child exit does not resolve globally unfenced remote effects');
    operatorChild.kill('SIGUSR2');
    const freezing=await until(async()=>{
      const status=await request('GET','/healthz');
      return status.data.localFreeze?.phase==='freezing'?status.data.localFreeze:null;
    });
    assert.equal(freezing.markerDurable,true);
    assert.equal(freezing.pendingExternal>=4,true);
    assert.equal((await request('GET','/readyz')).status,503);
    await stop(agentChild);
    agentChild=null;
    await stop(operatorChild);
    assert.equal(fs.existsSync(journalPath+'.owner.lock'),true);
    assert.ok(journal().pending.length>=4);
    const check=spawnSync(process.execPath,[operatorEntry],{
      cwd,env:operatorEnv,encoding:'utf8',timeout:4000});
    assert.notEqual(check.status,0);
    assert.match(check.stderr,/DEV_REMOTE_EFFECT_JOURNAL_PENDING_RESTART_REFUSED|LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
  }finally{
    // A failed test must not leave its UAT OS child running. Only target the
    // exact observed PID if /proc confirms the disposable sleep process.
    if(Number.isSafeInteger(childOsPid)&&childOsPid>0){
      try{
        const cmdline=fs.readFileSync('/proc/'+childOsPid+'/cmdline','utf8');
        if(cmdline.startsWith('/bin/sleep'+String.fromCharCode(0))&&cmdline.includes('12'))
          process.kill(childOsPid,'SIGKILL');
      }catch{}
    }
    await stop(agentChild);
    await stop(operatorChild);
    if(bridge)await new Promise(resolve=>bridge.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
