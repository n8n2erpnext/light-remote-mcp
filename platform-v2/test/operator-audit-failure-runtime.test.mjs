import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

// Inject a REAL append error in an independently spawned Operator. No Agent,
// production credentials, external network or actual customer data is touched.
test('dev Operator stops new requests after an asynchronous audit fsync failure',
  {timeout:30000},async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-audit-fault-'));
    for(const sub of ['state','log','socket','freeze']){
      fs.mkdirSync(path.join(dir,sub),{mode:0o700});
    }
    const socketPath=path.join(dir,'socket','op.sock');
    const logFile=path.join(dir,'log','operations.jsonl');
    const marker=path.join(dir,'freeze','marker.json');
    const entry=fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url));
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    const env={
      PATH:process.env.PATH||'/usr/bin:/bin',
      HOME:dir,LANG:'C',NODE_ENV:'test',
      OPERATOR_SOCKET:socketPath,OPERATOR_STATE_DIR:path.join(dir,'state'),
      OPERATOR_LOG_DIR:path.join(dir,'log'),OPERATOR_INTEGRATED_HOST:'0',
      OPERATOR_ACCOUNT_ID:'uat_owner',OPERATOR_DEVICE_ID:'uat_local_device',
      OPERATOR_NODE_ID:'uat_node',OPERATOR_KEY_FILE:path.join(dir,'missing-key'),
      OPERATOR_DISK_FLUSH_MS:'10',OPERATOR_DISK_BATCH_BYTES:'512',
      LR_RC50_DEV_LOCAL_FREEZE:'1',
      LR_RC50_OPERATOR_FREEZE_MARKER_PATH:marker,
      LIGHT_REMOTE_VERSION:'0.9.0-rc.50'
    };
    const child=spawn(process.execPath,[entry],
      {cwd,env,stdio:['ignore','pipe','pipe']});
    let stderr='';
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-5000);});
    const call=(requestPath)=>new Promise((resolve,reject)=>{
      const req=http.request({socketPath,path:requestPath,method:'GET',timeout:1800},res=>{
        let body='';res.on('data',d=>body+=d);
        res.on('end',()=>resolve({status:res.statusCode,body}));
      });
      req.on('error',reject);
      req.on('timeout',()=>req.destroy(Error('operator_http_timeout')));
      req.end();
    });
    const eventually=async(fn)=>{
      const until=Date.now()+11000;
      while(Date.now()<until){
        try{const x=await fn();if(x)return x;}catch{}
        await sleep(70);
      }
      throw Error('operator_audit_failure_condition_timeout '+stderr.slice(-700));
    };
    try{
      await eventually(async()=>{
        if(child.exitCode!==null)throw Error('operator_early_exit');
        const r=await call('/healthz');
        return r.status===200&&JSON.parse(r.body).localFreeze?.phase==='open';
      });
      // The log name is UAT-only. Make its next O_NOFOLLOW append fail with
      // EISDIR. No chmod changes to another process or the host are needed.
      if(fs.existsSync(logFile)){
        fs.renameSync(logFile,path.join(dir,'log','prior-uat-events.jsonl'));
      }
      fs.mkdirSync(logFile,{mode:0o700});
      // The deliberately invalid account ID emits a real executor_error
      // audit event without creating an account, session, device or job.
      const invalid=await call('/v1/plugin/sessions?accountId=');
      assert.equal(invalid.status,400);
      await eventually(()=>fs.existsSync(marker));
      const failClosed=await eventually(async()=>{
        const health=await call('/healthz');
        const state=JSON.parse(health.body).localFreeze;
        return state?.phase==='freezing'&&state.sealFailed===true?state:null;
      });
      assert.equal(failClosed.drained,false);
      assert.equal(failClosed.markerDurable,true);
      assert.equal((await call('/v1/capabilities')).status,503);
      const readiness=await call('/readyz');
      assert.equal(readiness.status,503);
      assert.equal(JSON.parse(readiness.body).ready,false);
      assert.equal(JSON.parse(readiness.body).localFreeze.sealFailed,true);
      assert.equal((await call('/healthz')).status,200);
      assert.match(stderr,/\[disk\] append failed/);
      assert.equal(fs.statSync(marker).mode&0o777,0o600);
    }finally{
      if(child.exitCode===null&&child.signalCode===null){
        child.kill('SIGTERM');
        await Promise.race([new Promise(r=>child.once('exit',r)),sleep(4500)]);
        if(child.exitCode===null&&child.signalCode===null){
          child.kill('SIGKILL');
          await sleep(90);
        }
      }
      fs.rmSync(dir,{recursive:true,force:true});
    }
  });
