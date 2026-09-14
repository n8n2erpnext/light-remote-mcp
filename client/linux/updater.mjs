import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UPDATE_CODES } from '../../lib/update-contract.mjs';
import {updateRuntimePaths,readJson,writeStatus,writeReport,clearRequest,clearCheckRequest,beginTransaction,clearTransaction,waitForCoreAck,finalizeHelperFromCore,helperVersion,updateCodeForError} from './update-lifeboat.mjs';

const ROOT=process.env.GPT_OPERATOR_INSTALL_ROOT||'/opt/gpt-operator-agent';
const CURRENT=path.join(ROOT,'current'), RELEASES=path.join(ROOT,'releases');
const PATHS=updateRuntimePaths(ROOT);
const PUBLIC_KEY=process.env.GPT_OPERATOR_UPDATE_PUBLIC_KEY||path.join(ROOT,'update-public.pem');
const MANIFEST_URL=process.env.GPT_OPERATOR_UPDATE_MANIFEST_URL||'https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json';
const SIGNATURE_URL=process.env.GPT_OPERATOR_UPDATE_SIGNATURE_URL||'https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig';
const SERVICE=process.env.GPT_OPERATOR_SERVICE||'gpt-operator-device-agent.service';
const USER_UNITS=['1','true','yes'].includes(String(process.env.LIGHT_REMOTE_SYSTEMD_USER_UNITS||'').toLowerCase());
const LOCK=path.join(PATHS.updaterRoot,'.update.lock');

function fail(message,code=UPDATE_CODES.UNKNOWN){const error=new Error(message);error.code=code;throw error;}
function coded(error,code,message=error?.message||'update_failed'){const next=new Error(message);next.code=code;next.cause=error;return next;}
function platformKey(){if(process.platform!=='linux')fail('linux_only');if(process.arch==='x64')return'linux-x64';if(process.arch==='arm64')return'linux-arm64';fail(`unsupported_arch:${process.arch}`);}
export function parseVersion(value){const m=String(value||'').replace(/^v/,'').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/);if(!m)return null;return{core:m.slice(1,4).map(Number),pre:m[4]?m[4].split('.'):[]};}
function comparePre(a,b){if(!a.length&&!b.length)return 0;if(!a.length)return 1;if(!b.length)return-1;for(let i=0;i<Math.max(a.length,b.length);i++){if(i>=a.length)return-1;if(i>=b.length)return 1;const ai=a[i],bi=b[i],an=/^\d+$/.test(ai),bn=/^\d+$/.test(bi);if(an&&bn){const d=Number(ai)-Number(bi);if(d)return d>0?1:-1;continue;}if(an!==bn)return an?-1:1;if(ai!==bi)return ai>bi?1:-1;}return 0;}
export function compareVersion(a,b){const aa=parseVersion(a),bb=parseVersion(b);if(!aa||!bb)return null;for(let i=0;i<3;i++){if(aa.core[i]>bb.core[i])return 1;if(aa.core[i]<bb.core[i])return-1;}return comparePre(aa.pre,bb.pre);}
export function newer(a,b){return compareVersion(a,b)>0;}
function run(file,args,{allowFailure=false}={}){const r=spawnSync(file,args,{encoding:'utf8'});if(!allowFailure&&r.status!==0)fail(`${file}_failed:${r.status}:${String(r.stderr||r.stdout).trim()}`);return r;}
async function download(url){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)throw new Error(`download_${r.status}:${url}`);return Buffer.from(await r.arrayBuffer());}
function verifyManifest(bytes,signatureText){const key=fs.readFileSync(PUBLIC_KEY,'utf8');let signature;try{signature=Buffer.from(String(signatureText||'').trim(),'base64');}catch{fail('invalid_manifest_signature_encoding',UPDATE_CODES.MANIFEST_SIGNATURE);}const ok=crypto.verify('sha256',bytes,key,signature);if(!ok)fail('invalid_manifest_signature',UPDATE_CODES.MANIFEST_SIGNATURE);}
function currentVersion(){try{return JSON.parse(fs.readFileSync(path.join(CURRENT,'manifest.json'),'utf8')).version||'0.0.0';}catch{return'0.0.0';}}
function atomicCurrent(target){const next=path.join(ROOT,`.current-${process.pid}`);try{fs.rmSync(next,{force:true});}catch{}fs.symlinkSync(target,next);fs.renameSync(next,CURRENT);}
function parseSystemctlState(r){const values=Object.fromEntries(String(r.stdout||'').split('\n').filter(Boolean).map(line=>{const i=line.indexOf('=');return i>0?[line.slice(0,i),line.slice(i+1)]:[line,''];}));const pid=Number(values.MainPID)||0;return {healthy:r.status===0&&values.ActiveState==='active'&&values.SubState==='running'&&pid>0,pid,activeState:values.ActiveState||'',subState:values.SubState||''};}
function userContexts(){if(!USER_UNITS)return[];let dirs=[];try{dirs=fs.readdirSync('/run/user',{withFileTypes:true});}catch{return[];}const out=[];for(const d of dirs){if(!d.isDirectory()||!/^\d+$/.test(d.name))continue;const uid=Number(d.name),runtime=`/run/user/${uid}`,bus=`${runtime}/bus`;if(!fs.existsSync(bus))continue;const pw=run('getent',['passwd',String(uid)],{allowFailure:true});if(pw.status!==0)continue;const user=String(pw.stdout||'').split(':')[0];if(user)out.push({uid,user,runtime,bus});}return out;}
function userSystemctl(ctx,args,{allowFailure=false}={}){return run('runuser',['-u',ctx.user,'--','env',`XDG_RUNTIME_DIR=${ctx.runtime}`,`DBUS_SESSION_BUS_ADDRESS=unix:path=${ctx.bus}`,'systemctl','--user',...args],{allowFailure});}
function serviceStates(){if(!USER_UNITS)return [parseSystemctlState(run('systemctl',['show',SERVICE,'--property=ActiveState','--property=SubState','--property=MainPID','--no-pager'],{allowFailure:true}))];return userContexts().map(ctx=>({...parseSystemctlState(userSystemctl(ctx,['show',SERVICE,'--property=ActiveState','--property=SubState','--property=MainPID','--no-pager'],{allowFailure:true})),uid:ctx.uid,user:ctx.user}));}
function restartServices(){if(!USER_UNITS){run('systemctl',['daemon-reload'],{allowFailure:true});return run('systemctl',['restart',SERVICE],{allowFailure:true}).status===0;}const contexts=userContexts();let ok=true;for(const ctx of contexts){userSystemctl(ctx,['daemon-reload'],{allowFailure:true});if(userSystemctl(ctx,['restart',SERVICE],{allowFailure:true}).status!==0)ok=false;}return ok;}
async function stableServiceHealthy(timeoutMs=12000,stableMs=3000){const deadline=Date.now()+timeoutMs;let healthySince=0;while(Date.now()<deadline){const states=serviceStates(),healthy=states.length===0||states.every(x=>x.healthy);if(healthy){if(!healthySince)healthySince=Date.now();if(Date.now()-healthySince>=stableMs)return true;}else healthySince=0;await new Promise(r=>setTimeout(r,250));}return false;}
function pruneReleases(keep=3){let rows=[];try{rows=fs.readdirSync(RELEASES,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({name:x.name,stat:fs.statSync(path.join(RELEASES,x.name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);}catch{return;}for(const row of rows.slice(keep)){const full=path.join(RELEASES,row.name);try{if(fs.realpathSync(CURRENT)===fs.realpathSync(full))continue;}catch{}fs.rmSync(full,{recursive:true,force:true});}}
function reportId(){return `ur_${crypto.randomBytes(14).toString('base64url')}`;}
function activeVersion(){return currentVersion();}
function updaterSelfTest(){const source=fileURLToPath(import.meta.url),contract=fileURLToPath(new URL('../../lib/update-contract.mjs',import.meta.url));if(!fs.existsSync(source)||!fs.existsSync(contract))return false;console.log(JSON.stringify({ok:true,runtime:'independent-updater',source,helperRoot:PATHS.updaterRoot,stateDir:PATHS.stateDir,helperVersion:helperVersion(PATHS)}));console.log('updater_selftest=PASS');return true;}
async function main(){
  if(process.argv.includes('--self-test')){if(!updaterSelfTest())process.exitCode=1;return;}
  const checkOnly=process.argv.includes('--check-only');
  if(process.getuid?.()!==0)fail('updater_requires_root');
  fs.mkdirSync(RELEASES,{recursive:true,mode:0o755});fs.mkdirSync(PATHS.updaterRoot,{recursive:true,mode:0o755});if(checkOnly)clearCheckRequest(PATHS);else clearRequest(PATHS);
  let lockFd;try{lockFd=fs.openSync(LOCK,'wx',0o600);}catch(error){if(error.code==='EEXIST'){console.log('update_already_running');return;}throw error;}
  const fromVersion=currentVersion(),helperBefore=helperVersion(PATHS)||fromVersion;let targetVersion=null,phase='checking',tx=null,reported=false;
  const status=(state,extra={})=>writeStatus(PATHS,{state,currentVersion:activeVersion(),targetVersion,helperVersion:helperVersion(PATHS)||helperBefore,...extra});
  const report=(input)=>{reported=true;return writeReport(PATHS,{reportId:reportId(),fromVersion,targetVersion,activeVersion:activeVersion(),helperVersion:helperVersion(PATHS)||helperBefore,platform:platformKey(),...input});};
  try{
    status('checking');
    let manifestBytes;try{manifestBytes=await download(MANIFEST_URL);}catch(error){throw coded(error,UPDATE_CODES.MANIFEST_FETCH);}
    if(!manifestBytes){status('idle');console.log('no_update_manifest');return;}
    let signatureBytes;try{signatureBytes=await download(SIGNATURE_URL);}catch(error){throw coded(error,UPDATE_CODES.MANIFEST_FETCH);}
    if(!signatureBytes)fail('update_signature_missing',UPDATE_CODES.MANIFEST_SIGNATURE);verifyManifest(manifestBytes,signatureBytes.toString('utf8'));
    const manifest=JSON.parse(manifestBytes.toString('utf8'));if(manifest.schemaVersion!==1)fail('unsupported_update_manifest',UPDATE_CODES.MANIFEST_SIGNATURE);
    targetVersion=String(manifest.version||'');if(!newer(targetVersion,fromVersion)){status('idle',{available:false,lastCheckedAt:Date.now()});console.log(`up_to_date:${fromVersion}`);return;}
    if(checkOnly){status('available',{available:true,lastCheckedAt:Date.now()});console.log(`update_available:${fromVersion}->${targetVersion}`);return;}
    phase='download_artifact';status('downloading',{available:true,lastCheckedAt:Date.now()});const artifact=manifest.artifacts?.[platformKey()];if(!artifact)fail(`artifact_missing:${platformKey()}`,UPDATE_CODES.ARTIFACT_MISSING);if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))fail('invalid_artifact_sha256',UPDATE_CODES.ARTIFACT_INTEGRITY);
    let archive;try{archive=await download(artifact.url);}catch(error){throw coded(error,UPDATE_CODES.ARTIFACT_MISSING);}if(!archive)fail('artifact_not_found',UPDATE_CODES.ARTIFACT_MISSING);if(Number(artifact.size)>0&&archive.length!==Number(artifact.size))fail('artifact_size_mismatch',UPDATE_CODES.ARTIFACT_INTEGRITY);const actual=crypto.createHash('sha256').update(archive).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(String(artifact.sha256),'hex')))fail('artifact_sha256_mismatch',UPDATE_CODES.ARTIFACT_INTEGRITY);
    phase='stage_core';status('staging_core');const target=path.join(RELEASES,targetVersion),tmp=path.join(RELEASES,`.incoming-${targetVersion}-${process.pid}`);try{fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true,mode:0o755});const archiveFile=path.join(tmp,'package.tar.gz');fs.writeFileSync(archiveFile,archive,{mode:0o600});run('tar',['--no-same-owner','-xzf',archiveFile,'-C',tmp]);fs.rmSync(archiveFile,{force:true});const packageRoot=path.join(tmp,'package');if(!fs.existsSync(path.join(packageRoot,'manifest.json')))fail('package_manifest_missing',UPDATE_CODES.CORE_STAGE);const packageManifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'manifest.json'),'utf8'));if(packageManifest.version!==targetVersion)fail('package_version_mismatch',UPDATE_CODES.CORE_STAGE);fs.rmSync(target,{recursive:true,force:true});fs.renameSync(packageRoot,target);run('chown',['-R','root:root',target]);run('chmod',['-R','go-w',target]);fs.rmSync(tmp,{recursive:true,force:true});}catch(error){try{fs.rmSync(tmp,{recursive:true,force:true});}catch{}throw error?.code?error:coded(error,UPDATE_CODES.CORE_STAGE);}
    let previous=null;try{previous=fs.realpathSync(CURRENT);}catch{}if(!previous)fail('current_release_missing',UPDATE_CODES.CORE_STAGE);
    tx=beginTransaction(PATHS,{fromVersion,targetVersion,helperVersion:helperBefore});phase='restart_core';status('installing_core');atomicCurrent(target);if(!restartServices())fail('core_restart_failed',UPDATE_CODES.CORE_RESTART);
    phase='verify_core';status('verifying_core');const serviceHealthy=await stableServiceHealthy(),ack=serviceHealthy?await waitForCoreAck(PATHS,tx,{timeoutMs:12000}):null;
    if(!serviceHealthy||!ack){
      status('rolling_back',{code:UPDATE_CODES.CORE_HEALTH});let rollbackHealthy=false;if(previous&&fs.existsSync(previous)){atomicCurrent(previous);const restarted=restartServices();rollbackHealthy=restarted&&await stableServiceHealthy(15000,3000);}
      const code=rollbackHealthy?UPDATE_CODES.CORE_HEALTH:UPDATE_CODES.ROLLBACK_FAILED;report({outcome:rollbackHealthy?'rollback':'failed',code,phase:'verify_core',rollback:{attempted:true,success:rollbackHealthy},detail:serviceHealthy?'core health acknowledgement timeout':'core service failed health gate'});clearTransaction(PATHS);
      if(!rollbackHealthy)fail(`update_rollback_failed:${targetVersion}`,UPDATE_CODES.ROLLBACK_FAILED);fail(`update_rollback:${targetVersion}`,UPDATE_CODES.CORE_HEALTH);
    }
    phase='finalize_helper';status('core_healthy');try{finalizeHelperFromCore(PATHS,target);}catch(error){const code=updateCodeForError(error,UPDATE_CODES.HELPER_FINALIZE);report({outcome:'failed',code,phase:'finalize_helper',rollback:{attempted:false,success:false},detail:error.message});status('core_healthy_helper_old',{code});clearTransaction(PATHS);pruneReleases();fail(`helper_finalize_failed:${error.message}`,code);}
    clearTransaction(PATHS);pruneReleases();status('success');report({outcome:'success',phase:'complete',rollback:{attempted:false,success:false}});console.log(`updated:${fromVersion}->${targetVersion}`);
  } catch(error) {
    if(!reported){const code=updateCodeForError(error,phase==='checking'?UPDATE_CODES.MANIFEST_FETCH:UPDATE_CODES.UNKNOWN);try{status('failed',{code});report({outcome:'failed',code,phase,rollback:{attempted:false,success:false},detail:error.message});}catch{}}
    throw error;
  } finally {try{if(lockFd!=null)fs.closeSync(lockFd);}catch{}try{fs.rmSync(LOCK,{force:true});}catch{}}
}

function invokedAsMain(){const arg=process.argv[1];if(!arg)return false;try{return fs.realpathSync(arg)===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return path.resolve(arg)===fileURLToPath(import.meta.url);}}
if(invokedAsMain())main().catch(error=>{console.error(`update_failed:${error.message}`);process.exitCode=1;});
