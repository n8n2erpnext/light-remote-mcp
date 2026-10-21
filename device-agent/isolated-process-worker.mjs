#!/usr/bin/env node
// Non-interactive worker in an independent systemd --user transient service.
// Worker owns stdout/exit receipt. Supervisor restart does not own its cgroup.
// Never relaunch worker on service restart; durable receipts are observation only.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createPlatformAdapter} from './platform-adapters/index.mjs';

const MAX_OUTPUT=4*1024*1024;
const arg=process.argv[2];
if(!arg||!path.isAbsolute(arg))throw Error('worker_absolute_request_required');
const dir=path.dirname(arg),st=fs.statSync(dir);
if(!st.isDirectory()||(st.mode&0o077)||(typeof process.getuid==='function'&&st.uid!==process.getuid()))throw Error('worker_private_directory_required');
const ast=fs.lstatSync(arg);
if(!ast.isFile()||ast.isSymbolicLink()||(ast.mode&0o077)||(typeof process.getuid==='function'&&ast.uid!==process.getuid()))throw Error('worker_request_insecure');
const request=JSON.parse(fs.readFileSync(arg,'utf8'));
if(!/^lp_[A-Za-z0-9_-]{20,80}$/.test(request.processId)||typeof request.script!=='string'||!request.script.trim())throw Error('worker_request_invalid');
fs.unlinkSync(arg); // sensitive script is never a durable journal payload
const stdoutFile=path.join(dir,'stdout.bin'),stderrFile=path.join(dir,'stderr.bin'),statusFile=path.join(dir,'status.json');
const out=fs.openSync(stdoutFile,'wx',0o600),err=fs.openSync(stderrFile,'wx',0o600);
let stdoutBytes=0,stderrBytes=0,stdoutStored=0,stderrStored=0,child,finished=false,stopRequested=false,forceStop=false;
let startedAt=Date.now(),childPid=null,timer=null,grace=null;
function persist(status){
 const tmp=path.join(dir,'.state-'+crypto.randomBytes(8).toString('hex'));
 const fd=fs.openSync(tmp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify({version:1,processId:request.processId,state:status,
  pid:process.pid,childPid,startedAt,finishedAt:finished?Date.now():null,exitCode:request.exitCode??null,
  stopRequested,stopForce:forceStop,stdoutBytes,stderrBytes,stdoutStored,stderrStored,
  outputAvailable:true,backend:'isolated-user-unit',unitName:request.unitName}));
  fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(tmp,statusFile);
 const d=fs.openSync(dir,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
}
function store(fd,chunk,type){
 const length=chunk.length;
 if(type==='stdout'){stdoutBytes+=length;const part=chunk.subarray(0,Math.max(0,MAX_OUTPUT-stdoutStored));if(part.length){fs.writeSync(fd,part);stdoutStored+=part.length;}}
 else {stderrBytes+=length;const part=chunk.subarray(0,Math.max(0,MAX_OUTPUT-stderrStored));if(part.length){fs.writeSync(fd,part);stderrStored+=part.length;}}
}
function signal(signame){
 if(!childPid)return;
 try{process.kill(-childPid,signame);}catch(e){if(e.code!=='ESRCH')throw e;}
}
function stop(force=false){
 if(finished)return;
 stopRequested=true;forceStop ||=force;
 try{signal(force?'SIGKILL':'SIGTERM');}catch{}
 persist('stopping');
 if(!force&&!grace)grace=setTimeout(()=>{if(!finished){forceStop=true;try{signal('SIGKILL');}catch{}}},2500);
}
process.once('SIGTERM',()=>stop(false));
process.once('SIGINT',()=>stop(false));
const adapter=createPlatformAdapter();
const spec=adapter.commandFor(request.script,{shell:request.shell});
if(!spec?.file||!Array.isArray(spec.args))throw Error('worker_shell_spec_invalid');
persist('starting');
child=spawn(spec.file,spec.args,{cwd:request.cwd||os.homedir(),stdio:['ignore','pipe','pipe'],
 env:{...process.env,GPT_OPERATOR_ACCOUNT:request.owner.accountId,GPT_OPERATOR_DEVICE:request.owner.deviceId,GPT_OPERATOR_SESSION:request.owner.sessionId},
 detached:true,windowsHide:true});
childPid=child.pid;
persist('running');
child.stdout.on('data',b=>store(out,b,'stdout'));
child.stderr.on('data',b=>store(err,b,'stderr'));
function complete(code,signal){
 if(finished)return;finished=true;
 if(timer)clearTimeout(timer);if(grace)clearTimeout(grace);
 try{signalGroupKill();}catch{}
 request.exitCode=Number.isInteger(code)?code:null;
 fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);
 persist(stopRequested?'stopped':signal==='SIGTERM'?'stopped':code===0?'finished':request.timedOut?'timeout':'error');
}
function signalGroupKill(){if(childPid)try{process.kill(-childPid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
child.on('error',error=>{store(err,Buffer.from(error.message+'\n'),'stderr');complete(127,null);});
child.on('exit',()=>{try{signalGroupKill();}catch{}});
child.on('close',complete);
const timeout=Math.max(1000,Math.min(Number(request.timeoutMs)||3600000,24*60*60*1000));
timer=setTimeout(()=>{request.timedOut=true;stop(false);},timeout);
timer.unref?.();
