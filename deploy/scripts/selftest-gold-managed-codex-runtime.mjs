import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createManagedCodexRuntime} from '../../device-agent/gold-codex-runtime-manager.mjs';
import {resolveGoldCodexBinary} from '../../device-agent/gold-codex-plus.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-managed-codex-'));
const root=path.join(dir,'codex-runtime'),npm=path.join(dir,'npm-cli.js');
fs.writeFileSync(npm,'// fixture npm entry');
let count=0;
const resolver=({managedRoot})=>path.join(managedRoot,'node_modules','official','codex');
const manager=createManagedCodexRuntime({root,env:{npm_execpath:npm},
  nodeExecutable:process.execPath,resolve:resolver,
  spawnImpl:(bin,args,opts)=>{
    assert.equal(bin,process.execPath);
    assert.ok(args.includes('--ignore-scripts'));
    assert.ok(args.includes('--include=optional'));
    assert.ok(args.includes('@openai/codex@latest'));
    assert.ok(args.includes('--registry=https://registry.npmjs.org/'));
    assert.ok(!args.includes('--global'));
    assert.equal(opts.windowsHide,true);
    count++;
    const child=new EventEmitter();
    queueMicrotask(()=>{
      const file=resolver({managedRoot:root+'.staging'});
      fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,'verified mock executable');
      child.emit('close',0);
    });
    return child;
  }});
try{
  assert.equal(manager.status().state,'missing');
  assert.equal(fs.existsSync(root),false,'OFF device must not install runtime');
  assert.equal(manager.install().state,'installing');
  assert.throws(()=>manager.install(),/codex_runtime_install_in_progress/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(manager.status().installed,true);
  assert.equal(manager.status().state,'installed');
  assert.equal(count,1);
  assert.equal(manager.install().state,'installed','idempotent');
  assert.equal(count,1);
  assert.equal(manager.remove().installed,false);
  assert.equal(fs.existsSync(root),false);
  const managedWin='C:\\Users\\Owner\\AppData\\Local\\Gold\\codex-runtime';
  const desired=path.win32.join(managedWin,'node_modules','@openai','codex-win32-x64',
    'vendor','x86_64-pc-windows-msvc','bin','codex.exe');
  assert.equal(resolveGoldCodexBinary({platform:'win32',env:{APPDATA:'C:\\Users\\Owner\\AppData\\Roaming',
    LOCALAPPDATA:'C:\\Users\\Owner\\AppData\\Local'},managedRoot:managedWin,exists:p=>p===desired}),desired);
  console.log('GOLD_MANAGED_CODEX_OWNER_OPT_IN_ISOLATED_INSTALL_UNINSTALL_NO_GLOBAL_NPM_PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
