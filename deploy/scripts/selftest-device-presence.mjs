import fs from 'node:fs';
import { DeviceRegistry, DeviceError } from '../../operator-host/device-registry.mjs';

const stateDir=`/tmp/gpt-vps-device-selftest-${process.pid}`;
const stateFile=`${stateDir}/devices.json`;
fs.rmSync(stateDir,{recursive:true,force:true});
let now=1_000_000;
const events=[];
const registry=new DeviceRegistry({stateFile,presenceTtlMs:90000,now:()=>now,emit:event=>events.push(event)});
const first=registry.register({accountId:'acct-local',deviceId:'arm-test',nodeId:'arm',displayName:'ARM Test',platform:'linux',architecture:'arm64',agentVersion:'0.6.0-dev',capabilities:['git','docker','git'],policyProfile:'self-hosted-owner'});
if(first.state!=='online'||first.capabilities.length!==2||first.firstSeenAt!==now) throw new Error('register_failed');
const originalLastSeen=first.lastSeenAt;
now+=90001;
const stale=registry.get('arm-test',{activeSessionsForNode:()=>3});
if(stale.state!=='offline'||stale.activeSessions!==3||stale.lastSeenAt!==originalLastSeen) throw new Error('ttl_offline_failed');
const recovered=registry.heartbeat('arm-test');
if(recovered.state!=='online'||!events.some(e=>e.type==='device_online')) throw new Error('heartbeat_recovery_failed');
const persisted=new DeviceRegistry({stateFile,presenceTtlMs:90000,now:()=>now,emit:()=>{}});
const loaded=persisted.get('arm-test');
if(loaded.firstSeenAt!==first.firstSeenAt||loaded.deviceId!=='arm-test') throw new Error('persistence_failed');let conflict=false;
try { persisted.register({accountId:'other',deviceId:'arm-test',nodeId:'arm'}); } catch(error) { conflict=error instanceof DeviceError && error.status===409; }
if(!conflict) throw new Error('identity_conflict_failed');
const offline=persisted.markOffline('arm-test','selftest');
if(offline.state!=='offline') throw new Error('explicit_offline_failed');
const disk=JSON.parse(fs.readFileSync(stateFile,'utf8'));
if(disk.schemaVersion!==1||disk.devices.length!==1) throw new Error('state_schema_failed');
console.log(JSON.stringify({ok:true,deviceId:first.deviceId,nodeId:first.nodeId,ttlOffline:stale.state,recovered:recovered.state,activeSessions:stale.activeSessions,identityConflict:conflict,persisted:true},null,2));
fs.rmSync(stateDir,{recursive:true,force:true});
