// Regression: owner-configured filesystem paths (no external services).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {normalizeFilesystemRoots,filesystemPolicy,executeNativeFs} from '../../lib/native-fs.mjs';
import {LightScpFileRegistry} from '../../lib/light-scp-file.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-gold-fs-'));
const folder=path.join(root,'allowed'),file=path.join(folder,'example.txt');
fs.mkdirSync(folder);fs.writeFileSync(file,'gold-fixture\n');
const bs=String.fromCharCode(92), winFolder='E:'+bs+'STREC',winDrive='E:'+bs;
const win=normalizeFilesystemRoots({readRoots:[winFolder],writeRoots:[winFolder]},{platform:'win32'});
assert.deepEqual(win.readRoots,[winFolder]);
assert.deepEqual(win.writeRoots,[winFolder]);
assert.deepEqual(normalizeFilesystemRoots({readRoots:[winDrive],writeRoots:[winFolder]},{platform:'win32'}).writeRoots,[winFolder]);
assert.throws(()=>normalizeFilesystemRoots({readRoots:['E:STREC'],writeRoots:[]},{platform:'win32'}),/filesystem_root_must_be_local_absolute_path/);
assert.throws(()=>normalizeFilesystemRoots({readRoots:[bs+bs+'server'+bs+'share'],writeRoots:[]},{platform:'win32'}),/filesystem_root_must_be_local_absolute_path/);
assert.throws(()=>normalizeFilesystemRoots({readRoots:[winFolder],writeRoots:['C:'+bs]},{platform:'win32'}),/filesystem_write_root_requires_read_root/);
let policy=filesystemPolicy({}, {readRoots:[],writeRoots:[]});
await assert.rejects(executeNativeFs({op:'stat',path:file},{policy}),e=>e.status===403&&e.message==='filesystem_path_outside_allowed_roots');
policy=filesystemPolicy({}, {readRoots:[folder],writeRoots:[folder]});
assert.equal((await executeNativeFs({op:'stat',path:file},{policy})).type,'file');
assert.equal((await executeNativeFs({op:'list',path:folder},{policy})).entries.length,1);
const scp=new LightScpFileRegistry({policy:()=>policy});
const transfer=await scp.beginDownload({source:file});
policy=filesystemPolicy({}, {readRoots:[],writeRoots:[]});
await assert.rejects(scp.readDownloadChunk(transfer.id,{index:0}),e=>e.status===403);
await scp.cancel(transfer.id);

const auth={enabled:true,mode:'local',identity:req=>req.headers['x-test-owner']==='ok'?{username:'owner'}:null,
  csrfForRequest:()=> 'valid',verifyRequestCsrf:(req,token)=>req.headers['x-test-owner']==='ok'&&token==='valid'};
let settings=filesystemPolicy({}, {readRoots:[folder],writeRoots:[folder]});
const wall=startLocalWall({host:'127.0.0.1',port:0,brandSvgPath:'/does/not/exist',auth,
  getLocalStatus:async()=>({enrolled:true,deviceId:'dev_test'}),
  getLocalPolicyStatus:async()=>({deviceId:'dev_test',grantableCapabilities:['filesystem'],approvedCapabilities:['filesystem'],effectiveCapabilities:['filesystem'],filesystemRoots:settings}),
  setFilesystemRoots:async input=>{const roots=normalizeFilesystemRoots(input);settings=filesystemPolicy({},roots);return settings;}
});
try{
  await new Promise(resolve=>wall.server.listening?resolve():wall.server.once('listening',resolve));
  const base='http://127.0.0.1:'+wall.server.address().port;
  let r=await fetch(base+'/api/filesystem-roots',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(r.status,401,'unauthenticated owner cannot change roots');
  r=await fetch(base+'/api/filesystem-roots',{method:'POST',headers:{'content-type':'application/json','x-test-owner':'ok'},body:'{}'});
  assert.equal(r.status,403,'missing CSRF cannot change roots');
  r=await fetch(base+'/permissions',{headers:{'x-test-owner':'ok'}});
  assert.equal(r.status,200);const html=await r.text();
  assert.match(html,/Filesystem access locations/);
  assert.match(html,/id="fs-read-roots"/);
  assert.match(html,/id="fs-write-roots"/);
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new Function(m[1]);
  r=await fetch(base+'/api/filesystem-roots',{method:'POST',
    headers:{'content-type':'application/json','x-test-owner':'ok','x-light-remote-csrf':'valid'},
    body:JSON.stringify({readRoots:[folder],writeRoots:[folder]})});
  assert.equal(r.status,200,await r.text());
  assert.equal(settings.readRoots[0],folder);
  r=await fetch(base+'/api/filesystem-roots',{method:'POST',
    headers:{'content-type':'application/json','x-test-owner':'ok','x-light-remote-csrf':'valid'},
    body:JSON.stringify({readRoots:[],writeRoots:[]})});
  assert.equal(r.status,200);
  assert.deepEqual(settings.readRoots,[]);
  console.log('GOLD_OWNER_FILESYSTEM_ROOTS_PASS root_validation,windows_paths,stat_list,scp_revoke,local_wall_auth_csrf,ui_script,owner_revoke');
}finally{
  await wall.close();await fsp.rm(root,{recursive:true,force:true});
}
