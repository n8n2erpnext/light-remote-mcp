import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {DeviceLocalActivityLog,ACTIVITY_LOG_PRESETS} from '../../device-agent/local-activity-log.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-wall-activity-test-'));
let now=Date.parse('2026-11-02T12:00:00.000Z');
const clock=()=>now;
const event=(id,chunk='sample')=>({id,at:new Date(now).toISOString(),type:'stdout',jobId:'job_'+id,chunk});
try{
  assert.deepEqual(ACTIVITY_LOG_PRESETS.standard,{fileBytes:50*1024*1024,archives:3});
  const log=new DeviceLocalActivityLog({root,deviceId:'dev_A1B2',now:clock});
  assert.equal(log.stat().usedBytes,0);
  assert.equal(log.add(event(1,'normal activity')),true);
  assert.equal(log.add(event(1,'normal activity')),false,'dedupe duplicate events');
  log.flush();
  assert.equal(log.recent(100).length,1);
  const onDisk=fs.readFileSync(log.file,'utf8');
  assert.ok(onDisk.includes('normal activity'));
  // Persisted records survive process restart, but duplicates do not.
  log.close();
  const restart=new DeviceLocalActivityLog({root,deviceId:'dev_A1B2',now:clock});
  assert.equal(restart.recent().length,1);
  assert.equal(restart.add(event(1)),false);
  assert.equal(restart.add(event(2,'password=hunter2 bearer abcdefghijklmnopqrstuvwxyzABCDEFGHIJ')),true);
  restart.flush();
  const persisted=fs.readFileSync(restart.file,'utf8');
  assert.doesNotMatch(persisted,/hunter2/);
  assert.doesNotMatch(persisted,/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ/);
  assert.match(persisted,/REDACTED/);
  // Force a tiny file cap in TEST INSTANCE ONLY. Real preset limits remain immutable.
  restart.config=()=>({fileBytes:500,archives:2});
  for(let i=3;i<30;i++){restart.add(event(i,'abcdefghijklmnopqrstuvwxyz'.repeat(2)));restart.flush();}
  assert.ok(fs.existsSync(restart.file+'.1.gz'),'rotation archive exists');
  assert.ok(fs.existsSync(restart.file+'.2.gz'),'second archive exists');
  assert.ok(!fs.existsSync(restart.file+'.3.gz'),'bounded retention');
  assert.ok(zlib.gunzipSync(fs.readFileSync(restart.file+'.1.gz')).length>0);
  assert.ok(fs.statSync(restart.file).size<=500,'active file bounded');
  restart.config=()=>({...ACTIVITY_LOG_PRESETS.standard});
  assert.equal(restart.setPreset('compact').preset,'compact');
  assert.equal(restart.setPreset('extended').preset,'extended');
  assert.throws(()=>restart.setPreset('unlimited'),/activity_log_preset_invalid/);
  assert.throws(()=>new DeviceLocalActivityLog({root,deviceId:'../escape'}),/activity_log_identity_required/);
  const countBefore=restart.recent().length;
  assert.ok(countBefore>0);
  restart.clean();
  assert.equal(restart.stat().usedBytes,0);
  assert.equal(restart.recent().length,0);
  assert.equal(restart.add(event(29)),false,'clean tombstone stops remote replay');
  now+=1000;
  assert.equal(restart.add(event(100)),true,'new post-clean event works');
  restart.flush();
  const after=new DeviceLocalActivityLog({root,deviceId:'dev_A1B2',now:clock});
  assert.equal(after.recent().length,1);
  assert.equal(after.recent()[0].id,100);
  after.freeSpaceOK=()=>false;
  now+=1000;
  after.add(event(101));after.flush();
  assert.equal(after.stat().lastError,'activity_log_low_disk_space');
  assert.ok(after.stat().usedBytes<=ACTIVITY_LOG_PRESETS.standard.fileBytes*4);
  after.close();
  console.log('GOLD_ABV2_DEVICE_LOCAL_ACTIVITY_LOG_ROTATION_REPLAY_REDACTION_CLEAN_DISK_GUARD_PASS');
}finally{fs.rmSync(root,{recursive:true,force:true});}
