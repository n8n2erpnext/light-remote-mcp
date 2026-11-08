import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {LocalIngressFreezeGate} from '../../lib/local-ingress-freeze.mjs';

async function withFixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-local-freeze-restart-'));
 try{return await fn(dir,path.join(dir,'operator-freeze.json'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('01 durable marker persists local freeze across a fresh Node process',()=>withFixture((dir,file)=>{
 const gate=new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'});
 return gate.freeze().then(result=>{
  assert.equal(result.phase,'frozen');
  assert.equal(gate.snapshot().markerDurable,true);
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(saved,{schemaVersion:1,service:'operator',phase:'freeze_requested'});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const moduleUrl=new URL('../../lib/local-ingress-freeze.mjs',import.meta.url).href;
  const source=`import {LocalIngressFreezeGate} from ${JSON.stringify(moduleUrl)};
    new LocalIngressFreezeGate({enabled:true,markerPath:process.env.UAT_FREEZE_FILE,service:'operator'});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],
    {env:{...process.env,UAT_FREEZE_FILE:file},encoding:'utf8',timeout:5000});
  assert.notEqual(child.status,0);
  assert.match(child.stderr,/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
 });
}));
test('02 invalid/tampered local marker refuses startup instead of reopening',()=>withFixture((dir,file)=>{
 fs.writeFileSync(file,'not-json',{mode:0o600});
 assert.throws(()=>new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'}));
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,service:'plugin',phase:'freeze_requested'}));
 assert.throws(()=>new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'}),/LOCAL_FREEZE_MARKER_INVALID/);
}));
test('03 symlinked marker is refused, and target is untouched',()=>withFixture((dir,file)=>{
 const victim=path.join(dir,'other');
 fs.writeFileSync(victim,'SENTINEL');
 fs.symlinkSync(victim,file);
 assert.throws(()=>new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'}));
 assert.equal(fs.readFileSync(victim,'utf8'),'SENTINEL');
}));
test('04 missing parent and world-writable marker dir fail closed',()=>withFixture((dir,file)=>{
 assert.throws(()=>new LocalIngressFreezeGate({enabled:true,
  markerPath:path.join(dir,'missing','mark'),service:'operator'}));
 fs.chmodSync(dir,0o777);
 assert.throws(()=>new LocalIngressFreezeGate({enabled:true,
  markerPath:file,service:'operator'}),/LOCAL_FREEZE_MARKER_PARENT_UNTRUSTED/);
}));
test('05 injected fsync or disk failure blocks ingress without declaring drained',()=>withFixture((dir,file)=>{
 const gate=new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator',
  persistMarker:()=>{throw Error('simulated_ENOSPC');}});
 assert.throws(()=>gate.freeze(),/simulated_ENOSPC/);
 assert.equal(gate.snapshot().phase,'freezing');
 assert.equal(gate.snapshot().markerDurable,false);
 assert.equal(gate.accepting,false);
 assert.equal(fs.existsSync(file),false);
 // A restart after failing to persist the marker is NOT safe. This is a
 // documented global release blocker, not a fake successful restart fence.
 assert.equal(new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'}).accepting,true);
}));
test('06 distinct local service markers do not globally fence one another',()=>withFixture((dir,file)=>{
 const pluginFile=path.join(dir,'plugin-freeze.json');
 const a=new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'});
 const b=new LocalIngressFreezeGate({enabled:true,markerPath:pluginFile,service:'plugin'});
 return a.freeze().then(()=>{
  assert.equal(a.accepting,false);
  assert.equal(b.accepting,true);
  assert.throws(()=>new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'}),/STARTUP_REFUSED/);
  assert.equal(new LocalIngressFreezeGate({enabled:true,markerPath:pluginFile,service:'plugin'}).accepting,true);
 });
}));
test('07 disabling opt-in cannot skip an existing marker when marker location stays configured',()=>withFixture(async(dir,file)=>{
 const gate=new LocalIngressFreezeGate({enabled:true,markerPath:file,service:'operator'});
 await gate.freeze();
 assert.throws(()=>new LocalIngressFreezeGate({
  enabled:false,markerPath:file,service:'operator'
 }),/LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED/);
 const source=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
 assert.match(source,/markerPath:process\.env\.LR_RC50_OPERATOR_FREEZE_MARKER_PATH\|\|null/);
 const plugin=fs.readFileSync(new URL('../../plugin-server/server.mjs',import.meta.url),'utf8');
 assert.match(plugin,/markerPath:process\.env\.LR_RC50_PLUGIN_FREEZE_MARKER_PATH\|\|null/);
}));
test('08 real dev source requires separate marker path per process',()=>{
 const root=new URL('../../',import.meta.url);
 const op=fs.readFileSync(new URL('operator-host/executor.mjs',root),'utf8');
 const plugin=fs.readFileSync(new URL('plugin-server/server.mjs',root),'utf8');
 assert.match(op,/LR_RC50_OPERATOR_FREEZE_MARKER_PATH/);
 assert.match(plugin,/LR_RC50_PLUGIN_FREEZE_MARKER_PATH/);
 assert.match(op,/LOCAL_FREEZE_OPERATOR_MARKER_REQUIRED/);
 assert.match(plugin,/LOCAL_FREEZE_PLUGIN_MARKER_REQUIRED/);
 assert.match(op,/marker_write_failed/);
 assert.match(plugin,/marker_write_failed/);
});
