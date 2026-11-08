import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createOperatorCryptoFixture} from '../../deploy/scripts/selftest-crypto-fixture.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';

// Signed dummy Agent counterpart over the REAL Operator's Unix HTTP routes.
// The agent never executes the command; result is a controlled fake ACK.
// This is NOT cross-host Agent binary/OS lifetime proof or P0 completion.
test('real Operator signed HTTP Fleet ACK cannot clear DEV WAL or authorize safe restart',
  {timeout:30000},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-signed-wal-http-'));
    const app=fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url));
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    for(const sub of ['state','log','socket','freeze'])
      fs.mkdirSync(path.join(root,sub),{mode:0o700});
    const socketPath=path.join(root,'socket','operator.sock');
    const markerPath=path.join(root,'freeze','operator.json');
    const journalPath=path.join(root,'state','dev-remote-effects.json');
    durableAtomicWriteSync(journalPath,JSON.stringify({schemaVersion:1,pending:[]})+'\n',
      {mode:0o600});
    const fixture=createOperatorCryptoFixture(path.join(root,'state'));
    const env={
      PATH:process.env.PATH||'/usr/bin:/bin',
      HOME:root,LANG:'C',NODE_ENV:'test',
      LIGHT_REMOTE_VERSION:'0.9.0-rc.50',
      OPERATOR_SOCKET:socketPath,
      OPERATOR_LOG_DIR:path.join(root,'log'),
      OPERATOR_STATE_DIR:path.join(root,'state'),
      OPERATOR_KEY_FILE:fixture.privateFile,
      OPERATOR_INTEGRATED_HOST:'0',
      OPERATOR_ACCOUNT_ID:'self-hosted-local',
      OPERATOR_DEVICE_ID:'arm-local',OPERATOR_NODE_ID:'arm',
      OPERATOR_CONNECTION_LEASE_ENFORCE:'1',
      OPERATOR_FLEET_CHANNEL_TTL_MS:'5000',
      OPERATOR_FLEET_COMMAND_LEASE_MS:'2000',
      LR_RC50_DEV_LOCAL_FREEZE:'1',
      LR_RC50_OPERATOR_FREEZE_MARKER_PATH:markerPath,
      LR_RC50_DEV_REMOTE_EFFECT_JOURNAL:'1',
      LR_RC50_DEV_REMOTE_EFFECT_JOURNAL_PATH:journalPath
    };
    let child=spawn(process.execPath,[app],{cwd,env,stdio:['ignore','pipe','pipe']});
    let stderr='';
    child.stderr.on('data',d=>{stderr=(stderr+String(d)).slice(-5000);});
    const request=(method,target,body)=>new Promise((resolve,reject)=>{
      const payload=body===undefined?null:Buffer.from(JSON.stringify(body));
      // Signed long-poll uses an 8s default even if the caller sends waitMs=0.
      const req=http.request({socketPath,method,path:target,
        timeout:target==='/v1/device-channel/poll'?12000:3000,
        headers:payload?{'content-type':'application/json','content-length':payload.length}:{}
      },res=>{
        let text='';res.on('data',d=>text+=d);
        res.on('end',()=>{
          try{resolve({status:res.statusCode,data:JSON.parse(text)})}
          catch{resolve({status:res.statusCode,data:{raw:text}})}
        });
      });
      req.on('error',reject);req.on('timeout',()=>req.destroy(Error('uat_http_timeout')));
      if(payload)req.write(payload);
      req.end();
    });
    async function until(fn,timeout=8000){
      for(let i=0;i<timeout/40;i++){
        const v=await fn().catch(()=>null);
        if(v)return v;
        await sleep(40);
      }
      throw Error('uat_http_condition_timeout '+stderr.slice(-450));
    }
    const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
    const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
    let deviceId='';
    function signed(action,payload) {
      const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');
      return {deviceId,timestamp,nonce,
        signature:crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,
          action,timestamp,nonce,payload})),privateKey).toString('base64url'),
        payload};
    }
    const snapshot=()=>JSON.parse(fs.readFileSync(journalPath,'utf8'));
    try{
      await until(async()=>{
        if(child.exitCode!==null)throw Error('operator_early_exit');
        return (await request('GET','/healthz')).status===200;
      });
      assert.equal(fs.existsSync(journalPath+'.owner.lock'),true);
      const begin=await request('POST','/v1/enrollments/begin',{
        publicIdentityKey,displayName:'DEV WAL Fake Agent',platform:'linux',
        architecture:'arm64',agentVersion:'0.9.0-rc.50',
        fingerprintSummary:'uat-fake',capabilities:['filesystem'],
        policyProfile:'uat-only'});
      assert.equal(begin.status,200,JSON.stringify(begin.data));
      const approval=await request('POST','/v1/enrollments/approve',{
        code:begin.data.enrollment.deviceCode,accountId:'self-hosted-local',
        approvedCapabilities:['filesystem'],policyProfile:'uat-only'});
      assert.equal(approval.status,200,JSON.stringify(approval.data));
      deviceId=approval.data.approval.deviceId;
      const nodeId=deviceId;
      const connection=await request('POST','/v1/device-channel/connect',
        signed('connect',{nodeId,agentVersion:'0.9.0-rc.50',requestedLeaseMs:3600000}));
      assert.equal(connection.status,200,JSON.stringify(connection.data));
      const hello={nodeId,agentVersion:'0.9.0-rc.50',policyRevision:1,
        sessionCeiling:1,draining:false,capabilities:['filesystem'],waitMs:1};
      const online=await request('POST','/v1/device-channel/poll',signed('poll',hello));
      assert.equal(online.status,200,JSON.stringify(online.data));
      assert.equal(online.data.channel.node.state,'online');
      const agentId='uat-agent-signed-wal-abcdefgh';
      const open=await request('POST','/v1/sessions/open',{
        agentId,openId:'open-uat-signed-wal-abcdefghijkl',nodeId,
        label:'isolated fake Agent',workspace:root,gracePreset:'30m'});
      assert.equal(open.status,200,JSON.stringify(open.data));
      const sessionId=open.data.session.sessionId;
      const envelope=fixture.seal({action:'exec_batch',
        operationId:'uat-operation-wal-signed-abcdefgh',
        script:'printf test-do-not-execute',sessionId,agentId,nodeId,
        requiredCapabilities:['filesystem'],waitMs:0,timeoutMs:10000});
      const started=await request('POST','/v1/execute',envelope);
      assert.equal(started.status,200,JSON.stringify(started.data));
      assert.equal(started.data.job.route,'outbound-leaf');
      assert.equal(started.data.job.status,'running');
      const commandId=started.data.job.commandId;
      assert.ok(commandId);
      assert.equal(snapshot().pending.length,1);
      assert.equal(snapshot().pending[0].commandId,commandId);
      assert.equal(fs.statSync(journalPath).mode&0o777,0o600);
      const unsigned=await request('POST','/v1/device-channel/poll',{
        deviceId,payload:hello});
      assert.notEqual(unsigned.status,200,'unsigned Agent must not poll the command');
      const polled=await request('POST','/v1/device-channel/poll',signed('poll',hello));
      assert.equal(polled.status,200,JSON.stringify(polled.data));
      assert.equal(polled.data.channel.command.commandId,commandId);
      const fakeAck={commandId,status:'ok',exitCode:0,stdout:'fake-done\n',
        stderr:'',durationMs:1};
      const forged=signed('result',fakeAck);
      forged.signature='invalid-fake-agent-signature';
      const rejected=await request('POST','/v1/device-channel/result',forged);
      assert.notEqual(rejected.status,200,'forged result must never settle command');
      assert.equal(snapshot().pending.length,1);
      const ack=await request('POST','/v1/device-channel/result',
        signed('result',fakeAck));
      assert.equal(ack.status,200,JSON.stringify(ack.data));
      assert.equal(ack.data.duplicate,false);
      assert.equal(ack.data.job.status,'ok');
      const duplicate=await request('POST','/v1/device-channel/result',
        signed('result',fakeAck));
      assert.equal(duplicate.status,200,JSON.stringify(duplicate.data));
      assert.equal(duplicate.data.duplicate,true);
      assert.equal(snapshot().pending.length,1,
        'successful signed Agent command ACK is not proof of remote process exit');
      assert.equal(child.kill('SIGUSR2'),true);
      const freezing=await until(async()=>{
        const res=await request('GET','/healthz');
        return res.data.localFreeze?.phase==='freezing'?res.data.localFreeze:null;
      });
      assert.equal(freezing.pendingExternal>=1,true);
      assert.equal((await request('GET','/readyz')).status,503);
      assert.equal((await request('GET','/v1/capabilities')).status,503);
      assert.equal(fs.statSync(markerPath).mode&0o777,0o600);
      child.kill('SIGTERM');
      const guard=new AbortController();
      let exit;
      try{
        exit=await Promise.race([
          new Promise(resolve=>child.once('exit',(code)=>resolve(code))),
          sleep(5500,null,{signal:guard.signal}).then(()=>{throw Error('uat_shutdown_timeout');})
        ]);
      }finally{guard.abort();}
      assert.notEqual(exit,0,'unknown remote effect must prevent clean exit');
      assert.equal(fs.existsSync(journalPath+'.owner.lock'),true);
      assert.equal(snapshot().pending.length,1);
      const restarted=spawnSync(process.execPath,[app],{cwd,env,encoding:'utf8',timeout:4500});
      assert.notEqual(restarted.status,0);
      assert.match(restarted.stderr,/DEV_REMOTE_EFFECT_JOURNAL_PENDING_RESTART_REFUSED|LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
    }finally{
      if(child.exitCode===null&&child.signalCode===null){
        child.kill('SIGKILL');await sleep(120);
      }
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
