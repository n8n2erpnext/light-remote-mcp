import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {compareVersion} from './version-compat.mjs';

function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){const k=argv[i];if(!k.startsWith('--'))continue;out[k.slice(2)]=argv[++i];}return out;}
export async function reconcileHelperAfterCoreHealth({mode='independent-helper',platform=process.platform,version,coreRoot,installRoot,stateDir,transactionFile,requestFile,checkRequestFile,emit=()=>{}}={}){
  if(mode!=='independent-helper')return{skipped:true,reason:mode||'managed'};
  if(platform==='win32')return{skipped:true,reason:'windows_native_helper'};
  if(transactionFile&&readJson(transactionFile))return{skipped:true,reason:'update_transaction_active'};
  if((requestFile&&fs.existsSync(requestFile))||(checkRequestFile&&fs.existsSync(checkRequestFile)))return{skipped:true,reason:'update_request_active'};
  const platformDir=platform==='darwin'?'macos':platform==='linux'?'linux':null;
  if(!platformDir)return{skipped:true,reason:'platform_without_helper'};
  const lifeboat=path.join(coreRoot,'client',platformDir,'update-lifeboat.mjs');
  if(!fs.existsSync(lifeboat))return{skipped:true,reason:'helper_not_packaged'};
  const coreManifest=readJson(path.join(coreRoot,'manifest.json'))||{},coreVersion=String(version||coreManifest.version||'').trim();if(!coreVersion)throw new Error('core_version_missing');
  const mod=await import(pathToFileURL(lifeboat).href),paths=mod.updateRuntimePaths(installRoot,stateDir),before=mod.helperVersion(paths),cmp=before?compareVersion(before,coreVersion):-1;
  const helperManifest=readJson(path.join(paths.helperCurrent,'manifest.json'))||{};
  const buildMismatch=Boolean(before===coreVersion&&((coreManifest.gitSha&&helperManifest.gitSha&&coreManifest.gitSha!==helperManifest.gitSha)||(coreManifest.coreDigest&&helperManifest.coreDigest&&coreManifest.coreDigest!==helperManifest.coreDigest)));
  let promoted=false;
  if(!before||cmp===null||cmp<0||(cmp===0&&buildMismatch)){
    const result=mod.finalizeHelperFromCore(paths,coreRoot);promoted=true;emit({event:'updater_helper_promoted',fromVersion:before||null,toVersion:result.version,buildMismatch});
  }
  const after=mod.helperVersion(paths)||before||coreVersion;
  mod.writeStatus(paths,{state:'idle',currentVersion:coreVersion,targetVersion:null,helperVersion:after,code:null});
  return{skipped:false,promoted,before,after,buildMismatch};
}
async function main(){
  const a=parseArgs(process.argv.slice(2)),coreRoot=path.resolve(a['core-root']||''),installRoot=path.resolve(a['install-root']||''),stateDir=path.resolve(a['state-dir']||'');
  if(!a['core-root']||!a['install-root']||!a['state-dir'])throw new Error('usage: update-helper-reconcile --core-root <path> --install-root <path> --state-dir <path> [--platform linux|darwin]');
  const value=await reconcileHelperAfterCoreHealth({mode:a.mode||'independent-helper',platform:a.platform||process.platform,version:a.version||null,coreRoot,installRoot,stateDir,transactionFile:a.transaction||path.join(stateDir,'transaction.json'),requestFile:a.request||path.join(stateDir,'request.json'),checkRequestFile:a['check-request']||path.join(stateDir,'check-request.json'),emit:event=>console.log(JSON.stringify(event))});
  console.log(JSON.stringify({ok:true,...value}));
}
function invokedAsMain(){const arg=process.argv[1];if(!arg)return false;try{return fs.realpathSync(arg)===fs.realpathSync(fileURLToPath(import.meta.url));}catch{return path.resolve(arg)===fileURLToPath(import.meta.url);}}
if(invokedAsMain())main().catch(error=>{console.error(JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
