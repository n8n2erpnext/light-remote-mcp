import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT=process.env.LIGHT_REMOTE_ROOT||'/Library/Application Support/Light Remote';
const CURRENT=path.join(ROOT,'current'), RELEASES=path.join(ROOT,'releases'), LOCK=path.join(ROOT,'.update.lock');
const PUBLIC_KEY=process.env.GPT_OPERATOR_UPDATE_PUBLIC_KEY||path.join(ROOT,'update-public.pem');
const MANIFEST_URL=process.env.GPT_OPERATOR_UPDATE_MANIFEST_URL||'https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json';
const SIGNATURE_URL=process.env.GPT_OPERATOR_UPDATE_SIGNATURE_URL||'https://raw.githubusercontent.com/n8n2erpnext/light-remote-mcp/main/channels/beta/client-update.json.sig';
const AGENT_LABEL='com.lightremote.agent', TRAY_LABEL='com.lightremote.tray';

function fail(message){ throw new Error(message); }
function run(file,args,{allowFailure=false}={}){ const r=spawnSync(file,args,{encoding:'utf8'}); if(!allowFailure&&r.status!==0) fail(`${path.basename(file)}_failed:${r.status}:${String(r.stderr||r.stdout).trim()}`); return r; }
function platformKey(){ if(process.platform!=='darwin') fail('macos_only'); if(process.arch==='x64') return 'macos-x64'; if(process.arch==='arm64') return 'macos-arm64'; fail(`unsupported_arch:${process.arch}`); }
function parseVersion(value){ const m=String(value||'').replace(/^v/,'').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/); return m?{core:m.slice(1,4).map(Number),pre:m[4]?m[4].split('.'):[]}:null; }
function comparePre(a,b){ if(!a.length&&!b.length)return 0;if(!a.length)return 1;if(!b.length)return-1;for(let i=0;i<Math.max(a.length,b.length);i++){if(i>=a.length)return-1;if(i>=b.length)return 1;const x=a[i],y=b[i],xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);if(xn&&yn){const d=Number(x)-Number(y);if(d)return d>0?1:-1;}else if(xn!==yn)return xn?-1:1;else if(x!==y)return x>y?1:-1;}return 0; }
function newer(a,b){ const aa=parseVersion(a),bb=parseVersion(b);if(!aa||!bb)return false;for(let i=0;i<3;i++){if(aa.core[i]!==bb.core[i])return aa.core[i]>bb.core[i];}return comparePre(aa.pre,bb.pre)>0; }
async function download(url){ const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(r.status===404)return null;if(!r.ok)fail(`download_${r.status}`);return Buffer.from(await r.arrayBuffer()); }
function verifyManifest(bytes,signatureText){ const key=fs.readFileSync(PUBLIC_KEY,'utf8');let signature;try{signature=Buffer.from(String(signatureText||'').trim(),'base64');}catch{fail('invalid_manifest_signature_encoding');}if(!signature.length||!crypto.verify('sha256',bytes,key,signature))fail('invalid_manifest_signature'); }
function currentVersion(){ try{return JSON.parse(fs.readFileSync(path.join(CURRENT,'manifest.json'),'utf8')).version||'0.0.0';}catch{return'0.0.0';} }
function atomicCurrent(target){ const next=path.join(ROOT,`.current-${process.pid}`);fs.rmSync(next,{force:true});fs.symlinkSync(target,next);fs.renameSync(next,CURRENT); }
function consoleContext(){ const result=run('/usr/bin/stat',['-f','%Su','/dev/console'],{allowFailure:true});const user=String(result.stdout||'').trim();if(!user||['root','_mbsetupuser','loginwindow'].includes(user))return null;const id=run('/usr/bin/id',['-u',user],{allowFailure:true});const uid=Number(String(id.stdout||'').trim());return Number.isInteger(uid)&&uid>0?{user,uid}:null; }
function launch(ctx,args,{allowFailure=false}={}){ return run('/bin/launchctl',['asuser',String(ctx.uid),'/bin/launchctl',...args],{allowFailure}); }
function agentState(ctx){ if(!ctx)return{healthy:true,pid:0};const r=launch(ctx,['print',`gui/${ctx.uid}/${AGENT_LABEL}`],{allowFailure:true});const text=String(r.stdout||'');const match=text.match(/\bpid\s*=\s*(\d+)/);return{healthy:r.status===0&&/\bstate\s*=\s*running\b/.test(text)&&Number(match?.[1])>0,pid:Number(match?.[1])||0}; }
function restartAgent(ctx){ if(!ctx)return true;launch(ctx,['enable',`gui/${ctx.uid}/${AGENT_LABEL}`],{allowFailure:true});return launch(ctx,['kickstart','-k',`gui/${ctx.uid}/${AGENT_LABEL}`],{allowFailure:true}).status===0; }
function restartTray(ctx){ if(!ctx)return;launch(ctx,['enable',`gui/${ctx.uid}/${TRAY_LABEL}`],{allowFailure:true});launch(ctx,['kickstart','-k',`gui/${ctx.uid}/${TRAY_LABEL}`],{allowFailure:true}); }
async function stableAgent(ctx,timeoutMs=15000,stableMs=3000){ if(!ctx)return true;const deadline=Date.now()+timeoutMs;let healthySince=0;while(Date.now()<deadline){if(agentState(ctx).healthy){if(!healthySince)healthySince=Date.now();if(Date.now()-healthySince>=stableMs)return true;}else healthySince=0;await new Promise(r=>setTimeout(r,250));}return false; }
function pruneReleases(keep=3){ let rows=[];try{rows=fs.readdirSync(RELEASES,{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.name.startsWith('.incoming-')).map(x=>({name:x.name,mtime:fs.statSync(path.join(RELEASES,x.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);}catch{return;}for(const row of rows.slice(keep)){const full=path.join(RELEASES,row.name);try{if(fs.realpathSync(CURRENT)===fs.realpathSync(full))continue;}catch{}fs.rmSync(full,{recursive:true,force:true});} }

async function main(){
  if(process.getuid?.()!==0)fail('updater_requires_root');fs.mkdirSync(RELEASES,{recursive:true,mode:0o755});let lockFd;
  try{lockFd=fs.openSync(LOCK,'wx',0o600);}catch(error){if(error.code==='EEXIST'){console.log('update_already_running');return;}throw error;}
  try{
    const manifestBytes=await download(MANIFEST_URL);if(!manifestBytes){console.log('no_update_manifest');return;}
    const signatureBytes=await download(SIGNATURE_URL);if(!signatureBytes)fail('update_signature_missing');verifyManifest(manifestBytes,signatureBytes.toString('utf8'));
    const manifest=JSON.parse(manifestBytes.toString('utf8'));if(manifest.schemaVersion!==1)fail('unsupported_update_manifest');const current=currentVersion();if(!newer(manifest.version,current)){console.log(`up_to_date:${current}`);return;}
    const artifact=manifest.artifacts?.[platformKey()];if(!artifact)fail(`artifact_missing:${platformKey()}`);if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))fail('invalid_artifact_sha256');
    const archive=await download(artifact.url);if(!archive)fail('artifact_not_found');if(Number(artifact.size)>0&&archive.length!==Number(artifact.size))fail('artifact_size_mismatch');const actual=crypto.createHash('sha256').update(archive).digest('hex');if(!crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(String(artifact.sha256),'hex')))fail('artifact_sha256_mismatch');
    const target=path.join(RELEASES,String(manifest.version)),tmp=path.join(RELEASES,`.incoming-${manifest.version}-${process.pid}`);fs.rmSync(tmp,{recursive:true,force:true});fs.mkdirSync(tmp,{recursive:true,mode:0o755});const archiveFile=path.join(tmp,'package.tar.gz');fs.writeFileSync(archiveFile,archive,{mode:0o600});run('/usr/bin/tar',['-xzf',archiveFile,'-C',tmp]);fs.rmSync(archiveFile,{force:true});
    const packageRoot=path.join(tmp,'package');const packageManifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'manifest.json'),'utf8'));if(packageManifest.version!==manifest.version)fail('package_version_mismatch');fs.rmSync(target,{recursive:true,force:true});fs.renameSync(packageRoot,target);run('/usr/sbin/chown',['-R','root:wheel',target]);run('/bin/chmod',['-R','go-w',target]);fs.rmSync(tmp,{recursive:true,force:true});
    let previous=null;try{previous=fs.realpathSync(CURRENT);}catch{}atomicCurrent(target);const ctx=consoleContext();const healthy=restartAgent(ctx)&&await stableAgent(ctx);
    if(!healthy){let rollbackHealthy=false;if(previous&&fs.existsSync(previous)){atomicCurrent(previous);rollbackHealthy=restartAgent(ctx)&&await stableAgent(ctx,18000,3000);}if(!rollbackHealthy)fail(`update_rollback_failed:${manifest.version}`);fail(`update_rollback:${manifest.version}`);}
    restartTray(ctx);pruneReleases();console.log(`updated:${current}->${manifest.version}`);
  } finally {try{if(lockFd!=null)fs.closeSync(lockFd);}catch{}try{fs.rmSync(LOCK,{force:true});}catch{}}
}
function invokedAsMain(){const arg=process.argv[1];if(!arg)return false;try{return fs.realpathSync(arg)===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return false;}}
if(invokedAsMain())main().catch(error=>{console.error(`update_failed:${error.message}`);process.exitCode=1;});
