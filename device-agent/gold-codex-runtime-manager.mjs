import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {resolveGoldCodexBinary} from './gold-codex-plus.mjs';

const fault=(message,status=409)=>Object.assign(new Error(message),{status});
function exists(file){try{return fs.statSync(file).isFile();}catch{return false;}}
function locateNpm(env,execPath){
  const osPath=process.platform==='win32'?path.win32:path;
  const guesses=[
    env.npm_execpath,
    osPath.join(osPath.dirname(execPath),'node_modules','npm','bin','npm-cli.js'),
    env.ProgramFiles?osPath.join(env.ProgramFiles,'nodejs','node_modules','npm','bin','npm-cli.js'):null,
    env.APPDATA?osPath.join(env.APPDATA,'npm','node_modules','npm','bin','npm-cli.js'):null
  ];
  return guesses.find(p=>p&&osPath.isAbsolute(p)&&exists(p))||null;
}
export function createManagedCodexRuntime({root,env=process.env,nodeExecutable=process.execPath,
    spawnImpl=spawn,platform=process.platform,resolve=resolveGoldCodexBinary}={}){
  if(!root||!path.isAbsolute(root))throw fault('codex_managed_runtime_root_invalid',400);
  const staged=root+'.staging';
  let installing=false,lastError=null,finishedAt=null,child=null;
  function native(installRoot=root){
    const target=resolve({platform,env:{...env,LIGHT_REMOTE_GOLD_CODEX_BINARY:'',CODEX_CLI_PATH:''},
      managedRoot:installRoot,exists});
    if(!target||path.relative(installRoot,target).startsWith('..')||path.isAbsolute(path.relative(installRoot,target)))return null;
    return target;
  }
  function status(){
    const binary=native();
    let externalAvailable=false;
    try{
      const external=resolve({platform,env,exists});
      externalAvailable=exists(external);
    }catch{}
    const managedInstalled=exists(binary);
    return {mode:'device_local_optional',installed:managedInstalled,externalAvailable,installing,
      state:installing?'installing':managedInstalled?'installed':externalAvailable?'external':lastError?'failed':'missing',
      lastError,finishedAt,runtime:'official_codex_cli',login:'device_local_chatgpt_plan'};
  }
  function install(){
    if(installing)throw fault('codex_runtime_install_in_progress');
    if(status().installed||status().externalAvailable)return status();
    const npm=locateNpm(env,nodeExecutable);
    if(!npm)throw fault('codex_runtime_installer_npm_unavailable',503);
    if(fs.existsSync(staged))throw fault('codex_runtime_previous_staging_requires_cleanup',409);
    if(fs.existsSync(root))throw fault('codex_runtime_partial_install_requires_cleanup',409);
    const home=path.dirname(root);
    fs.mkdirSync(home,{recursive:true,mode:0o700});
    fs.mkdirSync(staged,{mode:0o700});
    installing=true;lastError=null;
    const args=[npm,'install','--prefix',staged,'@openai/codex@latest',
      '--include=optional','--ignore-scripts','--no-audit','--no-fund',
      '--registry=https://registry.npmjs.org/'];
    const proc=spawnImpl(nodeExecutable,args,{
      cwd:home,env:{...env,npm_config_update_notifier:'false'},
      stdio:['ignore','ignore','ignore'],windowsHide:true
    });
    child=proc;
    let finished=false;
    const complete=(error)=>{
      if(finished)return;finished=true;installing=false;child=null;finishedAt=Date.now();
      if(error)lastError=String(error).slice(0,110);
      else {
        try{
          if(!exists(native(staged)))throw fault('codex_runtime_native_binary_not_found');
          fs.renameSync(staged,root);
          lastError=null;
        }catch(e){lastError=String(e?.message||e).slice(0,110);}
      }
      if(lastError){try{fs.rmSync(staged,{recursive:true,force:true});}catch{}}
    };
    proc.on('error',()=>complete('codex_runtime_install_spawn_failed'));
    proc.on('close',code=>complete(code===0?null:'codex_runtime_install_failed'));
    return status();
  }
  function remove(){
    if(installing||child)throw fault('codex_runtime_install_in_progress');
    if(!fs.existsSync(root))return status();
    if(fs.lstatSync(root).isSymbolicLink())throw fault('codex_runtime_symlink_forbidden',403);
    fs.rmSync(root,{recursive:true,force:true});
    lastError=null;finishedAt=Date.now();
    return status();
  }
  return {status,install,remove,managedRoot:root};
}
