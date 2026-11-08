import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

// Real, self-contained Operator Unix HTTP runtime, with no integrated Agent,
// no external internet, no real owner auth, and only isolated fake tmp files.
// This is LOCAL ingress/restart coverage, NOT an authenticated writer epoch.
test('actual Operator: health, SIGUSR2 freeze, 503, marker and restart denial',
  {timeout:25000},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-op-runtime-'));
    const source=fileURLToPath(new URL('../../operator-host/executor.mjs',import.meta.url));
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    for(const sub of ['state','log','socket','freeze'])
      fs.mkdirSync(path.join(root,sub),{mode:0o700});
    const socketPath=path.join(root,'socket','operator.sock');
    const markerPath=path.join(root,'freeze','marker.json');
    const env={...process.env,
      OPERATOR_SOCKET:socketPath,OPERATOR_STATE_DIR:path.join(root,'state'),
      OPERATOR_LOG_DIR:path.join(root,'log'),OPERATOR_INTEGRATED_HOST:'0',
      OPERATOR_ACCOUNT_ID:'uat_owner_only',OPERATOR_DEVICE_ID:'uat_device_local',
      OPERATOR_NODE_ID:'uat_node',OPERATOR_KEY_FILE:path.join(root,'absent-private-key'),
      LR_RC50_DEV_LOCAL_FREEZE:'1',LR_RC50_OPERATOR_FREEZE_MARKER_PATH:markerPath,
      LIGHT_REMOTE_VERSION:'0.9.0-rc.50'};
    const children=[];
    const start=(override={})=>{
      const child=spawn(process.execPath,[source],{
        cwd,env:{...env,...override},stdio:['ignore','pipe','pipe']
      });
      const row={child,stderr:'',stdout:''};
      child.stderr.on('data',d=>{row.stderr=(row.stderr+d).slice(-4500);});
      child.stdout.on('data',d=>{row.stdout=(row.stdout+d).slice(-4500);});
      children.push(row);
      return row;
    };
    const request=url=>new Promise((resolve,reject)=>{
      const req=http.request({socketPath,path:url,method:'GET',timeout:2000},res=>{
        let body='';res.on('data',d=>body+=d);
        res.on('end',()=>resolve({status:res.statusCode,body}));
      });
      req.on('error',reject);
      req.on('timeout',()=>req.destroy(Error('operator_request_timeout')));
      req.end();
    });
    const until=async(fn,ms=10000)=>{
      const started=Date.now();
      while(Date.now()-started<ms){
        try{const value=await fn();if(value)return value;}catch{}
        await sleep(80);
      }
      throw Error('operator_runtime_condition_timeout');
    };
    const stop=async(row)=>{
      const {child}=row;
      if(child.exitCode!==null||child.signalCode!==null)return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise(resolve=>child.once('exit',resolve)),sleep(4500)
      ]);
      if(child.exitCode===null&&child.signalCode===null){
        child.kill('SIGKILL');
        await sleep(80);
      }
    };
    try{
      const first=start();
      const health=await until(async()=>{
        if(first.child.exitCode!==null)throw Error('operator_start_failed');
        const res=await request('/healthz');
        if(res.status!==200)return null;
        const body=JSON.parse(res.body);
        return body.ok===true&&body.localFreeze?.phase==='open'?body:null;
      });
      assert.equal(health.localFreeze.enabled,true);
      const readyOpen=await request('/readyz');
      assert.equal(readyOpen.status,200);
      assert.equal(JSON.parse(readyOpen.body).ready,true);
      assert.equal((await request('/v1/capabilities')).status,200);
      assert.equal(first.child.kill('SIGUSR2'),true);
      await until(()=>fs.existsSync(markerPath));
      const frozen=await until(async()=>{
        const res=await request('/healthz');
        const parsed=JSON.parse(res.body);
        return parsed.localFreeze?.phase==='frozen'&&
          parsed.localFreeze?.markerDurable===true?parsed:null;
      });
      assert.equal(frozen.localFreeze.inflight,0);
      const readyFrozen=await request('/readyz');
      assert.equal(readyFrozen.status,503);
      assert.equal(JSON.parse(readyFrozen.body).ready,false);
      assert.equal((await request('/healthz')).status,200);
      const rejected=await request('/v1/capabilities');
      assert.equal(rejected.status,503);
      assert.equal(JSON.parse(rejected.body).error,'local_ingress_frozen');
      await stop(first);
      assert.equal(first.child.exitCode,0,
        'shutdown failed: '+first.stderr.slice(-400));
      const second=start();
      await until(()=>second.child.exitCode!==null||second.child.signalCode!==null);
      assert.notEqual(second.child.exitCode,0);
      assert.match(second.stderr,/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
      const third=start({LR_RC50_DEV_LOCAL_FREEZE:'0'});
      await until(()=>third.child.exitCode!==null||third.child.signalCode!==null);
      assert.notEqual(third.child.exitCode,0);
      assert.match(third.stderr,/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
      assert.equal(fs.statSync(markerPath).mode&0o777,0o600);
    }finally{
      for(const row of children)await stop(row);
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
