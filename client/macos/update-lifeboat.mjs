import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {UPDATE_CODES,normalizeUpdateReport,normalizeUpdateStatus} from '../../lib/update-contract.mjs';

const now=()=>Date.now();
function atomicJson(file,value,mode=0o644){const dir=path.dirname(file);fs.mkdirSync(dir,{recursive:true});const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode});fs.chmodSync(tmp,mode);fs.renameSync(tmp,file);}
export function updateRuntimePaths(root,stateDir=process.env.LIGHT_REMOTE_UPDATE_STATE_DIR||'/var/lib/light-remote/update-runtime'){
  const updaterRoot=path.join(root,'updater');
  return {root,stateDir,updaterRoot,helperCurrent:path.join(updaterRoot,'current'),helperReleases:path.join(updaterRoot,'releases'),request:path.join(stateDir,'request.json'),checkRequest:path.join(stateDir,'check-request.json'),transaction:path.join(stateDir,'transaction.json'),ack:path.join(stateDir,'core-health-ack.json'),report:path.join(stateDir,'pending-report.json'),status:path.join(stateDir,'status.json')};
}
export function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
export function writeStatus(paths,input){const value=normalizeUpdateStatus({...input,updatedAt:now()});atomicJson(paths.status,value);return value;}
export function writeReport(paths,input){const report=normalizeUpdateReport(input);atomicJson(paths.report,report);return report;}
export function clearRequest(paths){try{fs.rmSync(paths.request,{force:true});}catch{}}
export function clearCheckRequest(paths){try{fs.rmSync(paths.checkRequest,{force:true});}catch{}}
export function beginTransaction(paths,{fromVersion,targetVersion,helperVersion}){const tx={schemaVersion:1,txId:`ut_${crypto.randomBytes(12).toString('base64url')}`,fromVersion:String(fromVersion||''),targetVersion:String(targetVersion||''),helperVersion:String(helperVersion||''),startedAt:now()};atomicJson(paths.transaction,tx);try{fs.rmSync(paths.ack,{force:true});}catch{}return tx;}
export function clearTransaction(paths){for(const file of [paths.transaction,paths.ack]){try{fs.rmSync(file,{force:true});}catch{}}}
export async function waitForCoreAck(paths,tx,{timeoutMs=15000,pollMs=250}={}){const deadline=now()+timeoutMs;while(now()<deadline){const ack=readJson(paths.ack);if(ack?.txId===tx.txId&&ack?.version===tx.targetVersion&&ack?.healthy===true)return ack;await new Promise(r=>setTimeout(r,pollMs));}return null;}
function copyFile(src,dst,mode=null){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);if(mode!=null)fs.chmodSync(dst,mode);}
function helperManifest(sourceRoot){const row=readJson(path.join(sourceRoot,'manifest.json'));if(!row?.version)throw new Error('helper_source_manifest_missing');return row;}
function helperReleaseName(manifest){const id=String(manifest.gitSha||manifest.coreDigest||'').replace(/[^0-9A-Za-z]/g,'').slice(0,12);return id?`${manifest.version}-${id}`:String(manifest.version);}
export function helperVersion(paths){const row=readJson(path.join(paths.helperCurrent,'manifest.json'));return row?.version||null;}
function helperReleaseFiles(sourceRoot,target){copyFile(path.join(sourceRoot,'runtime','node'),path.join(target,'runtime','node'),0o755);copyFile(path.join(sourceRoot,'client','macos','updater.mjs'),path.join(target,'client','macos','updater.mjs'),0o644);copyFile(path.join(sourceRoot,'client','macos','update-lifeboat.mjs'),path.join(target,'client','macos','update-lifeboat.mjs'),0o644);copyFile(path.join(sourceRoot,'lib','update-contract.mjs'),path.join(target,'lib','update-contract.mjs'),0o644);copyFile(path.join(sourceRoot,'manifest.json'),path.join(target,'manifest.json'),0o644);}
function atomicHelperCurrent(paths,target){fs.mkdirSync(paths.updaterRoot,{recursive:true});const next=path.join(paths.updaterRoot,`.current-${process.pid}`);try{fs.rmSync(next,{force:true});}catch{}fs.symlinkSync(target,next);fs.renameSync(next,paths.helperCurrent);}
function pruneHelpers(paths,keep=3){let rows=[];try{rows=fs.readdirSync(paths.helperReleases,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('.incoming-')).map(x=>({name:x.name,mtime:fs.statSync(path.join(paths.helperReleases,x.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);}catch{return;}for(const row of rows.slice(keep)){const full=path.join(paths.helperReleases,row.name);try{if(fs.realpathSync(paths.helperCurrent)===fs.realpathSync(full))continue;}catch{}fs.rmSync(full,{recursive:true,force:true});}}
export function finalizeHelperFromCore(paths,sourceRoot,{env=process.env}={}){
  const manifest=helperManifest(sourceRoot),version=String(manifest.version),releaseName=helperReleaseName(manifest),target=path.join(paths.helperReleases,releaseName),tmp=path.join(paths.helperReleases,`.incoming-${releaseName}-${process.pid}`);
  fs.mkdirSync(paths.helperReleases,{recursive:true});fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true});helperReleaseFiles(sourceRoot,tmp);
  const smoke=spawnSync(path.join(tmp,'runtime','node'),[path.join(tmp,'client','macos','updater.mjs'),'--self-test'],{encoding:'utf8',env:{...env,LIGHT_REMOTE_ROOT:paths.root,LIGHT_REMOTE_UPDATE_STATE_DIR:paths.stateDir,LIGHT_REMOTE_UPDATER_ROOT:paths.updaterRoot}});
  if(smoke.status!==0||!String(smoke.stdout||'').includes('updater_selftest=PASS')){fs.rmSync(tmp,{recursive:true,force:true});const e=new Error('helper_candidate_selftest_failed');e.code=UPDATE_CODES.HELPER_HEALTH;throw e;}
  fs.rmSync(target,{recursive:true,force:true});fs.renameSync(tmp,target);atomicHelperCurrent(paths,target);pruneHelpers(paths);return {version,target};
}
export function updateCodeForError(error,fallback=UPDATE_CODES.UNKNOWN){const code=String(error?.code||'');return /^LRU\d{3}$/.test(code)?code:fallback;}
