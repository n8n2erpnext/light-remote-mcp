import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';
import {DeviceConnectionRegistry} from '../../operator-host/device-connection-registry.mjs';

const mk=()=>fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-last-two-writers-'));
function assertSealedFile(file){
  const st=fs.lstatSync(file);
  assert.equal(st.isSymbolicLink(),false);
  assert.equal(st.isFile(),true);
  assert.equal(st.nlink,1);
  assert.equal(st.mode&0o777,0o600);
  const tmp=fs.readdirSync(path.dirname(file)).filter(x=>x.endsWith('.tmp'));
  assert.deepEqual(tmp,[],'no reusable predictable temp files');
}
const accountUrl=new URL('../../operator-host/account-registry.mjs',import.meta.url).href;
const connectionUrl=new URL('../../operator-host/device-connection-registry.mjs',import.meta.url).href;
const invoke=(code,dir)=>{
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],
    {encoding:'utf8',cwd:dir,timeout:12000});
  assert.equal(result.status,0,'isolated child must observe expected fail-closed error: '+result.stderr);
};

test('actual account registry writes fsynced 0600 state and survives new instance',()=>{
  const dir=mk(),file=path.join(dir,'accounts.json');
  try{
    const first=new AccountRegistry({stateFile:file,bootstrapAccountId:'uat_bootstrap'});
    const grp=first.createGroup('UAT Restorable');
    assert.ok(grp.groupId);
    first._persist();
    assertSealedFile(file);
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(saved.schemaVersion,2);
    assert.ok(saved.groups.some(g=>g.name==='UAT Restorable'));
    const second=new AccountRegistry({stateFile:file,bootstrapAccountId:'uat_bootstrap'});
    assert.equal(second.loadError,null);
    assert.ok([...second.groups.values()].some(g=>g.name==='UAT Restorable'));
    assertSealedFile(file);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual connection registry persists private native lease, renew and disconnect across instance changes',()=>{
  const dir=mk(),file=path.join(dir,'connections.json');
  try{
    const stamp=1800000000000,now=()=>stamp;
    const first=new DeviceConnectionRegistry({stateFile:file,now});
    const connected=first.connect({accountId:'uat_account',deviceId:'uat_device',
      plan:'free',requestedLeaseMs:3600_000});
    assert.equal(connected.state,'connected');
    assertSealedFile(file);
    const second=new DeviceConnectionRegistry({stateFile:file,now});
    assert.equal(second.loadError,null);
    assert.equal(second.assertConnected('uat_device').connectionId,connected.connectionId);
    second.renew('uat_device',{requestedLeaseMs:7200_000});
    assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).connections[0].hardExpiresAt,
      stamp+7200_000);
    const third=new DeviceConnectionRegistry({stateFile:file,now});
    third.disconnect('uat_device');
    assert.equal(new DeviceConnectionRegistry({stateFile:file,now})
      .get('uat_device').state,'dormant');
    assertSealedFile(file);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
for(const [kind,moduleUrl,logic] of [
  ['account',accountUrl,"new AccountRegistry({stateFile:file,bootstrapAccountId:'uat_bootstrap'})"],
  ['connection',connectionUrl,"new DeviceConnectionRegistry({stateFile:file}).connect({accountId:'uat_account',deviceId:'uat_device'})"]
]){
  test(kind+' injected file fsync failure cannot acknowledge new state or leave partial file',()=>{
    const dir=mk(),file=path.join(dir,'failure.json');
    try{
      const code=`import fs from 'node:fs';
        import {${kind==='account'?'AccountRegistry':'DeviceConnectionRegistry'}} from ${JSON.stringify(moduleUrl)};
        const file=${JSON.stringify(file)};
        let calls=0;
        fs.fsyncSync=()=>{calls++;throw Error('uat_sync_disk_failure')};
        try{${logic};process.exit(7)}
        catch(e){if(e.message!=='uat_sync_disk_failure'||calls!==1)process.exit(8)}`;
      invoke(code,dir);
      assert.equal(fs.existsSync(file),false);
      assert.deepEqual(fs.readdirSync(dir),[],'failed atomic temp removed');
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
}
test('both actual registries refuse symlink target without overwriting its existing content',()=>{
  for(const [kind,moduleUrl,expr] of [
    ['account',accountUrl,"new AccountRegistry({stateFile:file,bootstrapAccountId:'uat_bootstrap'})"],
    ['connection',connectionUrl,"new DeviceConnectionRegistry({stateFile:file}).connect({accountId:'uat_account',deviceId:'uat_device'})"]
  ]){
    const dir=mk(),target=path.join(dir,'sentinel'),file=path.join(dir,'state.json');
    try{
      fs.writeFileSync(target,'DO_NOT_MODIFY',{mode:0o600});
      fs.symlinkSync(target,file);
      const code=`import { ${kind==='account'?'AccountRegistry':'DeviceConnectionRegistry'} } from ${JSON.stringify(moduleUrl)};
        const file=${JSON.stringify(file)};
        try{${expr};process.exit(9)}
        catch(e){if(e.message!=='durable_state_untrusted_target') { console.error('unexpected symlink deny',e.message);process.exit(10) }}`;
      invoke(code,dir);
      assert.equal(fs.readFileSync(target,'utf8'),'DO_NOT_MODIFY');
      assert.equal(fs.lstatSync(file).isSymbolicLink(),true);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});

for(const [kind,moduleUrl,setup,write] of [
  ['account',accountUrl,
    "const item=new AccountRegistry({stateFile:null,bootstrapAccountId:'uat_bootstrap'});item.stateFile=file;",
    "item._persist()"],
  ['connection',connectionUrl,
    "const item=new DeviceConnectionRegistry({stateFile:file})",
    "item.connect({accountId:'uat_account',deviceId:'uat_device'})"]
]){
  test(kind+' parent directory fsync ACK ambiguity permanently poisons same writer',()=>{
    const dir=mk(),file=path.join(dir,'ambiguous.json');
    try{
      const code=`import fs from 'node:fs';
        import {${kind==='account'?'AccountRegistry':'DeviceConnectionRegistry'}} from ${JSON.stringify(moduleUrl)};
        const file=${JSON.stringify(file)};
        ${setup}
        const real=fs.fsyncSync;let calls=0;
        fs.fsyncSync=(fd)=>{calls++;if(calls===2)throw Error('uat_parent_sync_unknown_commit');return real(fd)};
        try{${write};process.exit(20)}
        catch(e){if(e.message!=='uat_parent_sync_unknown_commit'||calls!==2)process.exit(21)}
        fs.fsyncSync=real;
        try{item._persist();process.exit(22)}
        catch(e){if(e.message!=='uat_parent_sync_unknown_commit')process.exit(23)}
        if(!fs.existsSync(file))process.exit(24)`;
      invoke(code,dir);
      const payload=JSON.parse(fs.readFileSync(file,'utf8'));
      assert.ok(payload.schemaVersion>=1);
      assertSealedFile(file);
      // The file may be visible after rename, but no durable ACK was issued.
      // On restart the data is not an authoritative cross-host checkpoint.
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
}
