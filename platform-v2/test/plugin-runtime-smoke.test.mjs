import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

// Runs the REAL Express/MCP Plugin process on 127.0.0.1 in an isolated UAT
// directory with FAKE credentials; no production services, payment traffic,
// external API call, device enrollment or Agent access.
test('actual Plugin: loopback health, HTTP freeze 503 and restart marker denial',
  {timeout:30000},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-plugin-runtime-'));
    const source=fileURLToPath(new URL('../../plugin-server/server.mjs',import.meta.url));
    const cwd=fileURLToPath(new URL('../../',import.meta.url));
    for(const dir of ['freeze','state','config','dist']){
      fs.mkdirSync(path.join(root,dir),{mode:0o700});
    }
    const reserve=net.createServer();
    await new Promise((resolve,reject)=>{
      reserve.once('error',reject);
      reserve.listen(0,'127.0.0.1',resolve);
    });
    const port=reserve.address().port;
    await new Promise(resolve=>reserve.close(resolve));
    const origin='http://127.0.0.1:'+port;
    const marker=path.join(root,'freeze','plugin-marker.json');
    // Deliberately do NOT spread process.env into the spawned service:
    // CI/owner secrets, OAuth, Paddle, SMTP or billing credentials must never
    // leak into UAT or authorize a real outgoing operation.
    const env={
      PATH:process.env.PATH||'/usr/bin:/bin',HOME:root,TMPDIR:'/tmp',
      LANG:'C',NODE_ENV:'test',LIGHT_REMOTE_VERSION:'0.9.0-rc.50',
      LIGHT_REMOTE_PLUGIN_ORIGIN:origin,
      LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',
      LIGHT_REMOTE_PLUGIN_PORT:String(port),
      LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1',
      LIGHT_REMOTE_PLUGIN_OAUTH_SECRET:crypto.randomBytes(36).toString('base64url'),
      LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:path.join(root,'config','oauth.key'),
      LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE:path.join(root,'state','oauth-clients.json'),
      LIGHT_REMOTE_OPENAI_CHALLENGE_FILE:path.join(root,'config','challenge'),
      LIGHT_REMOTE_GOOGLE_OAUTH_FILE:path.join(root,'state','google-oauth.json'),
      LIGHT_REMOTE_PADDLE_STATE_FILE:path.join(root,'state','paddle.json'),
      LIGHT_REMOTE_PADDLE_CHECKOUT_ENABLED:'0',
      LIGHT_REMOTE_SITE_CONTENT_PATH:path.join(root,'state','announcements.json'),
      LIGHT_REMOTE_SUPPORT_OUTBOX_FILE:path.join(root,'state','support-outbox.json'),
      LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE:path.join(root,'config','backoffice.json'),
      LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE:path.join(root,'config','recovery.json'),
      LIGHT_REMOTE_MAIL_ENV_FILE:path.join(root,'config','mail.env'),
      LIGHT_REMOTE_DISTRIBUTION_DIR:path.join(root,'dist'),
      LIGHT_REMOTE_DISTRIBUTION_MANIFEST:path.join(root,'dist','manifest.json'),
      OPERATOR_SOCKET:path.join(root,'nonexistent-operator.sock'),
      LR_RC50_DEV_LOCAL_FREEZE:'1',
      LR_RC50_PLUGIN_FREEZE_MARKER_PATH:marker,
    };
    const children=[];
    const start=(override={})=>{
      const child=spawn(process.execPath,[source],{
        cwd,env:{...env,...override},stdio:['ignore','pipe','pipe']
      });
      const rec={child,stderr:'',stdout:''};
      child.stderr.on('data',d=>{rec.stderr=(rec.stderr+d).slice(-5000);});
      child.stdout.on('data',d=>{rec.stdout=(rec.stdout+d).slice(-5000);});
      children.push(rec);
      return rec;
    };
    const request=(url,method='GET')=>new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:url,method,timeout:2000},res=>{
        let body='';res.on('data',d=>body+=d);
        res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));
      });
      req.on('error',reject);
      req.on('timeout',()=>req.destroy(Error('plugin_request_timeout')));
      req.end();
    });
    const until=async(fn,ms=12000)=>{
      const startMs=Date.now();
      while(Date.now()-startMs<ms){
        try{const value=await fn();if(value)return value;}catch{}
        await sleep(80);
      }
      throw Error('plugin_runtime_condition_timeout');
    };
    const stop=async(record)=>{
      const {child}=record;
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
      const original=start();
      const health=await until(async()=>{
        if(original.child.exitCode!==null)throw Error('plugin_startup_failed');
        const res=await request('/healthz');
        if(res.status!==200)return null;
        const data=JSON.parse(res.body);
        return data.ok===true&&data.localFreeze?.phase==='open'?data:null;
      });
      assert.equal(health.localFreeze.enabled,true);
      const readyOpen=await request('/readyz');
      assert.equal(readyOpen.status,200);
      assert.equal(JSON.parse(readyOpen.body).ready,true);
      assert.equal((await request('/support')).status,200);
      assert.equal(original.child.kill('SIGUSR2'),true);
      await until(()=>fs.existsSync(marker));
      const frozen=await until(async()=>{
        const res=await request('/healthz');
        const data=JSON.parse(res.body);
        return data.localFreeze?.phase==='frozen'&&
          data.localFreeze?.markerDurable===true?data:null;
      });
      assert.equal(frozen.localFreeze.inflight,0);
      const readyFrozen=await request('/readyz');
      assert.equal(readyFrozen.status,503);
      assert.equal(JSON.parse(readyFrozen.body).ready,false);
      const rejected=await request('/billing/paddle/webhook','POST');
      assert.equal(rejected.status,503);
      assert.equal(JSON.parse(rejected.body).error,'local_ingress_frozen');
      assert.equal((await request('/support')).status,503);
      assert.equal((await request('/healthz')).status,200);
      await stop(original);
      assert.equal(original.child.exitCode,0,
        'plugin shutdown failed: '+original.stderr.slice(-450));
      const restarted=start();
      await until(()=>restarted.child.exitCode!==null||restarted.child.signalCode!==null);
      assert.notEqual(restarted.child.exitCode,0);
      assert.match(restarted.stderr,/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
      const bypass=start({LR_RC50_DEV_LOCAL_FREEZE:'0'});
      await until(()=>bypass.child.exitCode!==null||bypass.child.signalCode!==null);
      assert.notEqual(bypass.child.exitCode,0);
      assert.match(bypass.stderr,/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
      assert.equal(fs.statSync(marker).mode&0o777,0o600);
    }finally{
      for(const child of children)await stop(child);
      fs.rmSync(root,{recursive:true,force:true});
    }
  });
