import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT=process.env.GPT_OPERATOR_INSTALL_ROOT||'/opt/gpt-operator-agent';
const CURRENT=path.join(ROOT,'current');
const RELEASES=path.join(ROOT,'releases');
const PUBLIC_KEY=process.env.GPT_OPERATOR_UPDATE_PUBLIC_KEY||path.join(ROOT,'update-public.pem');
const MANIFEST_URL=process.env.GPT_OPERATOR_UPDATE_MANIFEST_URL||'https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json';
const SIGNATURE_URL=process.env.GPT_OPERATOR_UPDATE_SIGNATURE_URL||'https://github.com/n8n2erpnext/light-remote-mcp/releases/latest/download/client-update.json.sig';
const SERVICE=process.env.GPT_OPERATOR_SERVICE||'gpt-operator-device-agent.service';
const LOCK=path.join(ROOT,'.update.lock');

function fail(message){throw new Error(message);}
function platformKey(){if(process.platform!=='linux')fail('linux_only');if(process.arch==='x64')return'linux-x64';if(process.arch==='arm64')return'linux-arm64';fail(`unsupported_arch:${process.arch}`);}
function parseVersion(value){const m=String(value||'').replace(/^v/,'').match(/^(\d+)\.(\d+)\.(\d+)$/);if(!m)return null;return m.slice(1).map(Number);}
function newer(a,b){const aa=parseVersion(a),bb=parseVersion(b);if(!aa||!bb)return false;for(let i=0;i<3;i++){if(aa[i]>bb[i])return true;if(aa[i]<bb[i])return false;}return false;}
function run(file,args,{allowFailure=false}={}){const r=spawnSync(file,args,{encoding:'utf8'});if(!allowFailure&&r.status!==0)fail(`${file}_failed:${r.status}:${String(r.stderr||r.stdout).trim()}`);return r;}
async function download(url){const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)fail(`download_${r.status}:${url}`);return Buffer.from(await r.arrayBuffer());}
function verifyManifest(bytes,signatureText){const key=fs.readFileSync(PUBLIC_KEY,'utf8');let signature;try{signature=Buffer.from(String(signatureText||'').trim(),'base64');}catch{fail('invalid_manifest_signature_encoding');}const ok=crypto.verify('sha256',bytes,key,signature);if(!ok)fail('invalid_manifest_signature');}
function currentVersion(){try{return JSON.parse(fs.readFileSync(path.join(CURRENT,'manifest.json'),'utf8')).version||'0.0.0';}catch{return'0.0.0';}}
function atomicCurrent(target){const next=path.join(ROOT,`.current-${process.pid}`);try{fs.rmSync(next,{force:true});}catch{}fs.symlinkSync(target,next);fs.renameSync(next,CURRENT);}
function activeService(){return run('systemctl',['is-active','--quiet',SERVICE],{allowFailure:true}).status===0;}
function pruneReleases(keep=3){let rows=[];try{rows=fs.readdirSync(RELEASES,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({name:x.name,stat:fs.statSync(path.join(RELEASES,x.name))})).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);}catch{return;}for(const row of rows.slice(keep)){const full=path.join(RELEASES,row.name);try{if(fs.realpathSync(CURRENT)===fs.realpathSync(full))continue;}catch{}fs.rmSync(full,{recursive:true,force:true});}}

async function main(){
  if(process.getuid?.()!==0)fail('updater_requires_root');
  fs.mkdirSync(RELEASES,{recursive:true,mode:0o755});
  let lockFd;try{lockFd=fs.openSync(LOCK,'wx',0o600);}catch(error){if(error.code==='EEXIST'){console.log('update_already_running');return;}throw error;}
  try{
    const manifestBytes=await download(MANIFEST_URL);if(!manifestBytes){console.log('no_update_manifest');return;}
    const signatureBytes=await download(SIGNATURE_URL);if(!signatureBytes)fail('update_signature_missing');
    verifyManifest(manifestBytes,signatureBytes.toString('utf8'));
    const manifest=JSON.parse(manifestBytes.toString('utf8'));if(manifest.schemaVersion!==1)fail('unsupported_update_manifest');
    const current=currentVersion();if(!newer(manifest.version,current)){console.log(`up_to_date:${current}`);return;}
    const artifact=manifest.artifacts?.[platformKey()];if(!artifact)fail(`artifact_missing:${platformKey()}`);
    if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))fail('invalid_artifact_sha256');
    const archive=await download(artifact.url);if(!archive)fail('artifact_not_found');
    if(Number(artifact.size)>0&&archive.length!==Number(artifact.size))fail('artifact_size_mismatch');
    const actual=crypto.createHash('sha256').update(archive).digest('hex');
    if(!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(String(artifact.sha256),'hex')))fail('artifact_sha256_mismatch');
    const target=path.join(RELEASES,String(manifest.version));
    const tmp=path.join(RELEASES,`.incoming-${manifest.version}-${process.pid}`);
    fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true,mode:0o755});
    const archiveFile=path.join(tmp,'package.tar.gz');fs.writeFileSync(archiveFile,archive,{mode:0o600});
    run('tar',['-xzf',archiveFile,'-C',tmp]);fs.rmSync(archiveFile,{force:true});
    const packageRoot=path.join(tmp,'package');if(!fs.existsSync(path.join(packageRoot,'manifest.json')))fail('package_manifest_missing');
    const packageManifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'manifest.json'),'utf8'));
    if(packageManifest.version!==manifest.version)fail('package_version_mismatch');
    fs.rmSync(target,{recursive:true,force:true});fs.renameSync(packageRoot,target);fs.rmSync(tmp,{recursive:true,force:true});
    let previous=null;try{previous=fs.realpathSync(CURRENT);}catch{}
    atomicCurrent(target);
    run('systemctl',['daemon-reload']);
    const restarted=run('systemctl',['restart',SERVICE],{allowFailure:true});
    await new Promise(r=>setTimeout(r,5000));
    if(restarted.status!==0||!activeService()){
      if(previous&&fs.existsSync(previous)){atomicCurrent(previous);run('systemctl',['daemon-reload'],{allowFailure:true});run('systemctl',['restart',SERVICE],{allowFailure:true});}
      fail(`update_rollback:${manifest.version}`);
    }
    pruneReleases();console.log(`updated:${current}->${manifest.version}`);
  } finally {try{if(lockFd!=null)fs.closeSync(lockFd);}catch{}try{fs.rmSync(LOCK,{force:true});}catch{}}
}

main().catch(error=>{console.error(`update_failed:${error.message}`);process.exitCode=1;});
