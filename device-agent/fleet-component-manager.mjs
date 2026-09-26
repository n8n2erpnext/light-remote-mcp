import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compareVersion,parseVersion} from '../lib/version-compat.mjs';

const DEFAULT_MANIFEST='https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/fleet-wall-module.json';
const DEFAULT_SIGNATURE=`${DEFAULT_MANIFEST}.sig`;
const VERSION_RE=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function rcTrain(value){const p=parseVersion(value);return p?.pre?.[0]==="rc"&&/^[0-9]+$/.test(p.pre[1]||"")?p.core.join(".")+"-rc."+Number(p.pre[1]):null;}
export function fleetVersionCanReplace(current,incoming){const a=parseVersion(current),b=parseVersion(incoming);if(!a||!b||a.raw===b.raw)return false;const at=rcTrain(a.raw),bt=rcTrain(b.raw);if(at&&bt&&at===bt)return false;return compareVersion(b.raw,a.raw)>0;}
function fail(message){throw new Error(message);}
function dataRoot(){
  if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Light Remote','components','fleet-wall');
  if(process.platform==='darwin')return path.join(os.homedir(),'Library','Application Support','Light Remote','components','fleet-wall');
  return path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'),'light-remote','components','fleet-wall');
}
function atomicJson(file,value){const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,file);}
async function download(url,maxBytes){
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)fail(`fleet_component_download_${r.status}`);
  const declared=Number(r.headers.get('content-length')||0);if(declared>maxBytes)fail('fleet_component_too_large');
  const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>maxBytes)fail('fleet_component_too_large');return bytes;
}
function verifyManifest(bytes,signatureText,publicKeyFile){
  const key=fs.readFileSync(publicKeyFile,'utf8');let signature;try{signature=Buffer.from(String(signatureText||'').trim(),'base64');}catch{fail('invalid_fleet_manifest_signature_encoding');}
  if(!signature.length||!crypto.verify('sha256',bytes,key,signature))fail('invalid_fleet_manifest_signature');
}
function safeArchiveEntries(archive){
  const r=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});if(r.status!==0)fail(`fleet_component_tar_list_failed:${r.status}`);
  const rows=String(r.stdout||'').split(/\r?\n/).filter(Boolean);if(!rows.length)fail('fleet_component_archive_empty');
  for(const row of rows){const n=row.replace(/\\/g,'/');if(n.startsWith('/')||n.includes('../')||!n.startsWith('fleet-wall/'))fail('fleet_component_archive_path_invalid');}
}
function extractArchive(archive,target){const r=spawnSync('tar',['-xzf',archive,'-C',target],{encoding:'utf8'});if(r.status!==0)fail(`fleet_component_tar_extract_failed:${r.status}`);}
function defaultPublicKeyFile(){
  if(process.env.GPT_OPERATOR_UPDATE_PUBLIC_KEY)return process.env.GPT_OPERATOR_UPDATE_PUBLIC_KEY;
  const candidates=[fileURLToPath(new URL('../client/update-public.pem',import.meta.url)),fileURLToPath(new URL('../../config/client-update-public.pem',import.meta.url))];
  return candidates.find(file=>fs.existsSync(file))||candidates[0];
}
export class FleetComponentManager{
  constructor({root=dataRoot(),manifestUrl=process.env.LIGHT_REMOTE_FLEET_MODULE_MANIFEST_URL||DEFAULT_MANIFEST,signatureUrl=process.env.LIGHT_REMOTE_FLEET_MODULE_SIGNATURE_URL||DEFAULT_SIGNATURE,publicKeyFile=defaultPublicKeyFile()}={}){
    this.root=root;this.releases=path.join(root,'releases');this.pointer=path.join(root,'current.json');this.manifestUrl=manifestUrl;this.signatureUrl=signatureUrl;this.publicKeyFile=publicKeyFile;
  }
  current(){
    try{const row=JSON.parse(fs.readFileSync(this.pointer,'utf8')),version=String(row.version||'');if(!VERSION_RE.test(version))return null;const release=path.join(this.releases,version),runtime=path.join(release,'device-agent','fleet-wall-runtime.mjs');if(!fs.existsSync(runtime))return null;return{version,release,runtime};}catch{return null;}
  }
  _validatePackage(dir,version){
    const file=path.join(dir,'manifest.json');if(!fs.existsSync(file))fail('fleet_component_manifest_missing');const m=JSON.parse(fs.readFileSync(file,'utf8'));
    if(m.component!=='fleet-wall'||m.version!==version)fail('fleet_component_manifest_mismatch');
    for(const rel of ['device-agent/fleet-wall-runtime.mjs','device-agent/local-wall-auth.mjs','lib/device-proof.mjs','lib/runtime-version.mjs','lib/brand.mjs','gateway/dashboard.mjs','gateway/device-policy-page.mjs','gateway/brand.mjs','assets/branding/light-remote-mark.svg','assets/fonts/CascadiaMono.ttf','assets/fonts/CascadiaMono-OFL.txt'])if(!fs.existsSync(path.join(dir,rel)))fail(`fleet_component_file_missing:${rel}`);
    return m;
  }
  _prepareRoot(){
    fs.mkdirSync(this.releases,{recursive:true,mode:0o700});
    try{fs.chmodSync(this.root,0o700);}catch{}
    try{fs.chmodSync(this.releases,0o700);}catch{}
  }
  _prune(keep=2){
    let rows=[];try{rows=fs.readdirSync(this.releases,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('.incoming-')).map(x=>({name:x.name,mtime:fs.statSync(path.join(this.releases,x.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);}catch{return;}
    const current=this.current()?.version||null;
    for(const row of rows.filter(x=>x.name!==current).slice(Math.max(0,keep-1))){try{fs.rmSync(path.join(this.releases,row.name),{recursive:true,force:true});}catch{}}
  }
  async ensureInstalled(){
    this._prepareRoot();
    const manifestBytes=await download(this.manifestUrl,256*1024),signatureBytes=await download(this.signatureUrl,64*1024);
    verifyManifest(manifestBytes,signatureBytes.toString('utf8'),this.publicKeyFile);
    let manifest;try{manifest=JSON.parse(manifestBytes.toString('utf8'));}catch{fail('invalid_fleet_component_manifest_json');}
    if(manifest.schemaVersion!==1||manifest.component!=='fleet-wall'||!VERSION_RE.test(String(manifest.version||'')))fail('invalid_fleet_component_manifest');
    const artifact=manifest.artifact||{};
    if(!/^https?:\/\//.test(String(artifact.url||'')))fail('invalid_fleet_component_url');
    if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))fail('invalid_fleet_component_sha256');
    const size=Math.max(1,Math.min(Number(artifact.size)||0,32*1024*1024));if(!size)fail('invalid_fleet_component_size');
    const existing=this.current();
    if(existing?.version===manifest.version)return{installed:false,...existing,manifest};
    if(existing&&!fleetVersionCanReplace(existing.version,manifest.version))return{installed:false,...existing,manifest,skipped:"not-newer"};
    const archiveBytes=await download(artifact.url,Math.min(32*1024*1024,size+1024));
    if(archiveBytes.length!==Number(artifact.size))fail('fleet_component_size_mismatch');
    const actual=crypto.createHash('sha256').update(archiveBytes).digest('hex');
    if(!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(String(artifact.sha256),'hex')))fail('fleet_component_sha256_mismatch');
    const incoming=path.join(this.releases,`.incoming-${manifest.version}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`),archive=path.join(incoming,'component.tar.gz');
    fs.mkdirSync(incoming,{recursive:true,mode:0o700});fs.writeFileSync(archive,archiveBytes,{mode:0o600});
    try{
      safeArchiveEntries(archive);extractArchive(archive,incoming);fs.rmSync(archive,{force:true});
      const unpacked=path.join(incoming,'fleet-wall');this._validatePackage(unpacked,manifest.version);
      const target=path.join(this.releases,manifest.version);fs.rmSync(target,{recursive:true,force:true});fs.renameSync(unpacked,target);
      fs.rmSync(incoming,{recursive:true,force:true});atomicJson(this.pointer,{component:'fleet-wall',version:manifest.version,installedAt:Date.now()});
      this._prune();const current=this.current();if(!current)fail('fleet_component_install_pointer_invalid');return{installed:true,...current,manifest};
    }catch(error){try{fs.rmSync(incoming,{recursive:true,force:true});}catch{}throw error;}
  }
}
