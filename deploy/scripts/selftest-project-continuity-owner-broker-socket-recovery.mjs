import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {bootstrapOwnerBroker,ownerBrokerEndpoint,
 recoverStaleOwnerBrokerSocket,startIsolatedControllerBroker}
 from '../../device-agent/project-continuity-owner-broker.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-cont-socket-recovery-'));
let broker;
try{
 fs.chmodSync(dir,0o700);
 bootstrapOwnerBroker({runtimeDir:dir,password:'fixture-socket-recovery-2026'});
 const target=ownerBrokerEndpoint(dir);
 assert.deepEqual(await recoverStaleOwnerBrokerSocket(dir),{recovered:false,reason:'absent'});
 broker=await startIsolatedControllerBroker({runtimeDir:dir,clientGroupMode:0o600});
 await once(broker.server,'listening');
 await assert.rejects(recoverStaleOwnerBrokerSocket(dir),/continuity_broker_socket_live/);
 assert.equal(fs.lstatSync(target).isSocket(),true);
 // Symlink and regular files must never be removed by stale-socket cleanup.
 await broker.stop();broker=null;
 fs.writeFileSync(target,'untrusted-file',{mode:0o600});
 await assert.rejects(recoverStaleOwnerBrokerSocket(dir),/continuity_broker_existing_socket_unsafe/);
 assert.equal(fs.readFileSync(target,'utf8'),'untrusted-file');
 fs.rmSync(target);
 fs.symlinkSync(path.join(dir,'owner-authority-public.pem'),target);
 await assert.rejects(recoverStaleOwnerBrokerSocket(dir),/continuity_broker_existing_socket_unsafe/);
 assert.equal(fs.lstatSync(target).isSymbolicLink(),true);
 fs.rmSync(target);
 console.log('CONTINUITY_BROKER_ACTIVE_SOCKET_NOT_REMOVED_PASS');
 console.log('CONTINUITY_BROKER_SYMLINK_AND_REGULAR_FILE_FAIL_CLOSED_PASS');
}finally{
 try{await broker?.stop();}catch{}
 fs.rmSync(dir,{recursive:true,force:true});
}
