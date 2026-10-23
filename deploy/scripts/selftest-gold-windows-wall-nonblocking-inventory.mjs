import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {createWindowsAdapter} from '../../device-agent/platform-adapters/windows.mjs';
import {defaultCommandExists,invalidateCommandExistenceCache} from '../../device-agent/platform-adapters/shared.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-win-wall-inventory-'));
const previousPath=process.env.Path,previousExt=process.env.PATHEXT;
try{
 const installed=['cmd.exe','powershell.exe','git.exe','node.exe','docker.cmd'];
 for(const name of installed)fs.writeFileSync(path.join(dir,name),'fixture executable');
 process.env.Path=dir;
 process.env.PATHEXT='.exe;.cmd';
 invalidateCommandExistenceCache();
 assert.equal(defaultCommandExists('win32','git'),true);
 assert.equal(defaultCommandExists('win32','docker'),true);
 assert.equal(defaultCommandExists('win32','missingtool'),false);
 assert.equal(defaultCommandExists('win32','../node'),false);
 // Each Windows inventory read must not launch a child process or walk the
 // same PATH repeatedly while Local Wall /api/status auto-refreshes.
 const adapter=createWindowsAdapter({commandExists:name=>defaultCommandExists('win32',name)});
 const began=performance.now();
 const caps=adapter.installedCapabilities();
 assert(caps.includes('git')&&caps.includes('docker')&&caps.includes('build-test'));
 assert(caps.includes('powershell')&&caps.includes('terminal'));
 assert(performance.now()-began<1000,'windows local capability read must not block the Node event loop');
 for(let n=0;n<12;n++)assert.deepEqual(adapter.installedCapabilities(),caps);
 let count=0;
 const counted=createWindowsAdapter({commandExists:name=>{count++;return name==='git'||name==='cmd.exe';}});
 counted.installedCapabilities();
 const afterFirst=count;
 for(let n=0;n<25;n++)counted.installedCapabilities();
 assert.equal(count,afterFirst,'Wall polls must reuse installed-inventory snapshot');
 counted.invalidateInstalledCapabilities();
 counted.installedCapabilities();
 assert(count>afterFirst,'explicit inventory rescan must refresh tool presence');
 const fakeLocal=()=>({deviceName:'WIN-FIXTURE',deviceId:'dev_win_fixture',enrolled:true,
  cloudDesiredConnected:true,cloudState:'connected',policyAuthority:'server-and-local',
  supportedCapabilities:adapter.discoverCapabilities(),installedCapabilities:adapter.installedCapabilities(),
  approvedCapabilities:['filesystem','terminal'],grantableCapabilities:['filesystem','terminal'],
  deniedCapabilities:[],localRequestedCapabilities:['filesystem','terminal'],localPolicyProfile:'full'});
 const wall=startLocalWall({host:'127.0.0.1',port:0,
  getLocalStatus:async()=>fakeLocal(),getLocalPolicyStatus:async()=>fakeLocal(),
  getRemoteStatus:async()=>new Promise(()=>{})});
 await new Promise(resolve=>wall.server.listening?resolve():wall.server.once('listening',resolve));
 const base='http://127.0.0.1:'+wall.server.address().port;
 try{
  // A remote observer lane may remain queued behind desktop RM traffic.
  // Its unresolved promise must NOT pin the first /api/status / Wall load.
  const firstAt=performance.now();
  const statusResponse=await fetch(base+'/api/status',{signal:AbortSignal.timeout(2500)});
  assert.equal(statusResponse.status,200);
  const status=await statusResponse.json();
  assert.equal(status.local.deviceName,'WIN-FIXTURE');
  assert.equal(status.remote.error,'remote_status_pending');
  assert.equal(status.remote.status,202);
  assert(performance.now()-firstAt<2100,'remote status cannot block initial Wall rendering');
  for(const route of ['/api/policy-status','/api/policy-status','/permissions']){
   const start=performance.now();
   const response=await fetch(base+route,{signal:AbortSignal.timeout(2500)});
   assert.equal(response.status,200,route+' must respond while remote observer lane is blocked');
   const body=await response.text();
   if(route==='/api/policy-status')assert.equal(JSON.parse(body).local.deviceName,'WIN-FIXTURE');
   else{
    for(const [,script] of body.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
   }
   assert(performance.now()-start<1800,route+' must not starve waiting for RM or remote status');
  }
 }finally{await wall.close();}
 console.log('WINDOWS_WALL_INVENTORY_NONBLOCKING_PASS no_where_exe_spawn,cached_inventory,explicit_invalidation,local_policy_fast_path,permissions_script_valid');
}finally{
 if(previousPath===undefined)delete process.env.Path;else process.env.Path=previousPath;
 if(previousExt===undefined)delete process.env.PATHEXT;else process.env.PATHEXT=previousExt;
 invalidateCommandExistenceCache();
 fs.rmSync(dir,{recursive:true,force:true});
}
