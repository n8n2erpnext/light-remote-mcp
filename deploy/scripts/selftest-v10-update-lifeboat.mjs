import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {updateRuntimePaths,beginTransaction,waitForCoreAck,finalizeHelperFromCore,helperVersion} from '../../client/linux/update-lifeboat.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-update-lifeboat-'));
const root=path.join(tmp,'install'),state=path.join(tmp,'state'),source=path.join(tmp,'core');
const paths=updateRuntimePaths(root,state);
fs.mkdirSync(path.join(source,'runtime'),{recursive:true});
fs.mkdirSync(path.join(source,'client/linux'),{recursive:true});
fs.mkdirSync(path.join(source,'lib'),{recursive:true});
fs.copyFileSync(process.execPath,path.join(source,'runtime/node'));fs.chmodSync(path.join(source,'runtime/node'),0o755);
fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({version:'0.9.1'}));
fs.writeFileSync(path.join(source,'client/linux/updater.mjs'),"if(process.argv.includes('--self-test')){console.log('updater_selftest=PASS');}\n");
fs.writeFileSync(path.join(source,'client/linux/update-lifeboat.mjs'),'export const placeholder=true;\n');
fs.writeFileSync(path.join(source,'lib/update-contract.mjs'),'export const placeholder=true;\n');
try{
  const tx=beginTransaction(paths,{fromVersion:'0.9.0',targetVersion:'0.9.1',helperVersion:'0.9.0'});
  setTimeout(()=>fs.writeFileSync(paths.ack,JSON.stringify({schemaVersion:1,txId:tx.txId,version:'0.9.1',healthy:true,at:Date.now()})),40);
  const ack=await waitForCoreAck(paths,tx,{timeoutMs:1000,pollMs:20});
  if(!ack||ack.version!=='0.9.1')throw new Error('core_ack_gate_failed');
  const final=finalizeHelperFromCore(paths,source);
  if(final.version!=='0.9.1'||helperVersion(paths)!=='0.9.1')throw new Error('helper_finalize_failed');
  if(fs.realpathSync(paths.helperCurrent)!==fs.realpathSync(final.target))throw new Error('helper_current_not_atomic');
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({version:'0.9.1',gitSha:'aaaaaaaaaaaaaaaa'}));const buildA=finalizeHelperFromCore(paths,source);
  fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({version:'0.9.1',gitSha:'bbbbbbbbbbbbbbbb'}));const buildB=finalizeHelperFromCore(paths,source);
  if(buildA.target===buildB.target||!buildA.target.includes('aaaaaaaaaaaa')||!buildB.target.includes('bbbbbbbbbbbb'))throw new Error('helper_build_identity_release_not_isolated');
  if(fs.realpathSync(paths.helperCurrent)!==fs.realpathSync(buildB.target))throw new Error('helper_build_identity_current_wrong');
  console.log('v10-update-core-ack-gate=PASS');
  console.log('v10-update-helper-finalize=PASS');
  console.log('v10-update-helper-build-identity=PASS');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}

const repo=path.resolve(new URL('../..',import.meta.url).pathname);
const install=fs.readFileSync(path.join(repo,'client/linux/install.sh'),'utf8');
const updater=fs.readFileSync(path.join(repo,'client/linux/updater.mjs'),'utf8');
if(!install.includes('gpt-operator-agent-update-check.service')||!install.includes('Unit=gpt-operator-agent-update-check.service'))throw new Error('periodic_check_only_service_missing');
if(!install.includes('gpt-operator-agent-update-check.path')||!install.includes('PathExists=$UPDATE_CHECK_REQUEST_FILE'))throw new Error('owner_check_trigger_missing');
if(!updater.includes("process.argv.includes('--check-only')")||!updater.includes("status('available'"))throw new Error('check_only_availability_contract_missing');
console.log('v10-update-owner-triggered-install=PASS');
