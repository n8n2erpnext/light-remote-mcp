import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {NativeDesktopBridge,realRemoteAvailable} from '../../lib/native-desktop.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const swift=fs.readFileSync(path.join(root,'client/macos/real-remote/main.swift'),'utf8');
const bridge=fs.readFileSync(path.join(root,'lib/native-desktop.mjs'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/macos-client-build.yml'),'utf8');

assert.equal(realRemoteAvailable({platform:'darwin',env:{},exists:()=>true}),false);
assert.equal(realRemoteAvailable({platform:'linux',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:'/dummy'},exists:()=>true}),false);
assert.equal(realRemoteAvailable({platform:'darwin',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:'/dummy'},exists:()=>true}),true);
assert.equal(realRemoteAvailable({platform:'win32',env:{LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:'/dummy'},exists:()=>true}),true);
assert.match(swift,/macos_screen_recording_permission_required/);
assert.match(swift,/args.contains\("--request-screen-recording"\)/);
assert.match(swift,/macos_accessibility_permission_required/);
assert.match(swift,/visual_lease_invalid/);
assert.match(swift,/SOCK_STREAM/);
assert.match(swift,/chmod\(address,0o600\)/);
assert.ok(bridge.includes("this.platform==='darwin'"));
assert.ok(workflow.includes('client/macos/real-remote/main.swift'));
console.log('macos-real-remote-gated-platform-contract=PASS');

const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'lr-macos-rmv2-test-'));
const helper=path.join(scratch,'mock-helper.mjs');
fs.writeFileSync(helper,`#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
const idx=process.argv.indexOf('--socket');
if(idx<0||!process.argv[idx+1])process.exit(12);
const sock=process.argv[idx+1];
const server=net.createServer(c=>{
  c.write(JSON.stringify({type:'event',eventName:'robot.ready',at:Date.now(),pid:process.pid})+'\\n');
  let buf='';
  c.on('data',chunk=>{buf+=chunk;while(buf.includes('\\n')){let pos=buf.indexOf('\\n');let line=buf.slice(0,pos);buf=buf.slice(pos+1);if(!line)continue;let msg=JSON.parse(line);c.write(JSON.stringify({type:'response',id:msg.id,ok:true,data:{runtime:'mock-macos-rmv2',receivedOp:msg.op}})+'\\n');}});
  c.on('end',()=>server.close());
});
server.listen(sock,()=>fs.chmodSync(sock,0o600));
process.on('SIGTERM',()=>{server.close();try{fs.unlinkSync(sock)}catch{};process.exit(0)});
`);
fs.chmodSync(helper,0o755);
try {
  const b=new NativeDesktopBridge({command:helper,platform:'darwin',timeoutMs:6500,idleMs:10000});
  try {
    const status=await b.request('status');
    assert.equal(status.runtime,'mock-macos-rmv2');
    assert.equal(status.receivedOp,'desktop.status');
    assert.equal(b.running,true);
    console.log('macos-real-remote-unix-socket-duplex-rpc=PASS');
  }finally{b.close();}
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
console.log('macos-real-remote-bridge-gate=PASS');
