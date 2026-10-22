import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {NativeTerminalReceiptSpool} from '../../lib/native-terminal-receipt-spool.mjs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-m6-native-ack-'));
const accountId='gold-native-uat',deviceId='dev-native-1';
const sample=(i)=>({accountId,deviceId,
  processId:'lp_'+crypto.createHash('sha256').update(String(i)).digest('base64url').slice(0,31),
  state:i%2?'stopped':'finished',finishedAt:1792670000000+i,exitCode:i%2?130:0});
try{
 const journal=new NativeTerminalReceiptSpool({directory:dir});
 const first=sample(1);
 assert.equal(journal.record(first),true);
 assert.equal(journal.record(first),false);
 assert.throws(()=>journal.record({...first,finishedAt:first.finishedAt+1}),/process_conflict/);
 assert.equal(journal.list('someone-else',deviceId).length,0);
 assert.equal(journal.list(accountId,'other-device').length,0);
 for(let i=2;i<=46;i++)journal.record(sample(i));
 assert.equal(journal.list(accountId,deviceId).length,32);
 const restarted=new NativeTerminalReceiptSpool({directory:dir});
 const batch=restarted.list(accountId,deviceId);
 assert.deepEqual(Object.keys(batch[0]).sort(),['exitCode','finishedAt','processId','state']);
 assert.throws(()=>restarted.acknowledge('bad-owner',deviceId,batch),/ack_mismatch/);
 assert.throws(()=>restarted.acknowledge(accountId,deviceId,[{...batch[0],finishedAt:batch[0].finishedAt+1}]),/ack_mismatch/);
 assert.equal(new NativeTerminalReceiptSpool({directory:dir}).list(accountId,deviceId).length,32);
 assert.equal(restarted.acknowledge(accountId,deviceId,batch),32);
 assert.equal(restarted.acknowledge(accountId,deviceId,batch),0);
 const leftover=new NativeTerminalReceiptSpool({directory:dir});
 assert.equal(leftover.list(accountId,deviceId).length,14);
 assert.equal(leftover.acknowledge(accountId,deviceId,leftover.list(accountId,deviceId)),14);
 assert.equal(new NativeTerminalReceiptSpool({directory:dir}).list(accountId,deviceId).length,0);
 console.log('M6_WINDOWS_MAC_NATIVE_TERMINAL_REPLAY_AFTER_RESTART=PASS');
 console.log('M6_NATIVE_DEVICE_OWNER_EXACT_ACK_AND_DUPLICATE=PASS');

 // Actual bounded OS-process lifecycle; only a proven terminal event enters
 // the spool. A running/unknown process is never spuriously acknowledged.
 const journal2=new NativeTerminalReceiptSpool({directory:dir});
 const events=[];
 const reg=new NativeProcessRegistry({emit:e=>{
   events.push(e.type);
   if(e.type==='process_finished')journal2.record(e);
 }});
 const nodeCommand=[process.execPath,'-e','process.stdout.write("ok")'];
 const p=reg.start({accountId,deviceId,sessionId:'s123',agentId:'signed-agent',
  script:'ignored',cwd:dir,spawnSpec:()=>({file:nodeCommand[0],args:nodeCommand.slice(1)})});
 assert.equal(journal2.list(accountId,deviceId).length,0);
 const deadline=Date.now()+5000;
 while(journal2.list(accountId,deviceId).length===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
 const terminal=journal2.list(accountId,deviceId);
 assert.equal(terminal.length,1);
 assert.equal(terminal[0].processId,p.processId);
 assert.equal(terminal[0].state,'finished');
 assert.equal(events.includes('process_finished'),true);
 assert.equal(new NativeTerminalReceiptSpool({directory:dir}).list(accountId,deviceId).length,1);
 console.log('M6_NATIVE_REAL_OS_EXIT_FSYNC_RECEIPT=PASS');

 const files=JSON.parse(fs.readFileSync(new URL('../../client/core-files.json',import.meta.url)));
 assert.ok(JSON.stringify(files).includes('lib/native-terminal-receipt-spool.mjs'));
 const agent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
 assert.match(agent,/NATIVE_TERMINAL_SPOOL\.record\(event\)/);
 assert.match(agent,/NATIVE_TERMINAL_SPOOL\.acknowledge\(/);
 assert.match(agent,/NATIVE_TERMINAL_SPOOL\.list\(/);
 console.log('M6_NATIVE_CROSS_PLATFORM_PACKAGE_AND_AGENT_WIRING=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
