import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {reconcileHelperAfterCoreHealth} from '../../lib/update-helper-reconcile.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-helper-reconcile-'));
const core=path.join(tmp,'core'),install=path.join(tmp,'install'),state=path.join(tmp,'state');
fs.mkdirSync(path.join(core,'client/linux'),{recursive:true});fs.mkdirSync(state,{recursive:true});
fs.writeFileSync(path.join(core,'client/linux/update-lifeboat.mjs'),String.raw`
import fs from 'node:fs';import path from 'node:path';
export function updateRuntimePaths(root,stateDir){return{helperCurrent:path.join(root,'updater/current'),status:path.join(stateDir,'status.json')}}
export function helperVersion(paths){try{return JSON.parse(fs.readFileSync(path.join(paths.helperCurrent,'manifest.json'),'utf8')).version}catch{return null}}
export function finalizeHelperFromCore(paths,source){const row=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')),dir=path.dirname(paths.helperCurrent);fs.mkdirSync(dir,{recursive:true});fs.rmSync(paths.helperCurrent,{recursive:true,force:true});fs.mkdirSync(paths.helperCurrent,{recursive:true});fs.writeFileSync(path.join(paths.helperCurrent,'manifest.json'),JSON.stringify(row));return{version:row.version,target:paths.helperCurrent}}
export function writeStatus(paths,value){fs.mkdirSync(path.dirname(paths.status),{recursive:true});fs.writeFileSync(paths.status,JSON.stringify(value));return value}
`);
function coreManifest(extra={}){fs.writeFileSync(path.join(core,'manifest.json'),JSON.stringify({version:'0.9.0-rc.24',gitSha:'sha-new',coreDigest:'digest-new',...extra}));}
function helperManifest(row){const d=path.join(install,'updater/current');fs.rmSync(d,{recursive:true,force:true});fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify(row));}
async function run(extra={}){return reconcileHelperAfterCoreHealth({mode:'independent-helper',platform:'linux',version:'0.9.0-rc.24',coreRoot:core,installRoot:install,stateDir:state,transactionFile:path.join(state,'transaction.json'),requestFile:path.join(state,'request.json'),checkRequestFile:path.join(state,'check-request.json'),...extra});}
try{
  coreManifest();helperManifest({version:'0.9.0-rc.7',gitSha:'old'});let r=await run();assert.equal(r.promoted,true);assert.equal(JSON.parse(fs.readFileSync(path.join(install,'updater/current/manifest.json'))).gitSha,'sha-new');let st=JSON.parse(fs.readFileSync(path.join(state,'status.json')));assert.equal(st.state,'idle');assert.equal(st.targetVersion,null);assert.equal(st.helperVersion,'0.9.0-rc.24');
  helperManifest({version:'0.9.0-rc.24',gitSha:'sha-old',coreDigest:'digest-old'});r=await run();assert.equal(r.promoted,true);assert.equal(r.buildMismatch,true);
  helperManifest({version:'0.9.0-rc.25',gitSha:'future'});r=await run();assert.equal(r.promoted,false);assert.equal(r.after,'0.9.0-rc.25');
  helperManifest({version:'0.9.0-rc.7'});fs.writeFileSync(path.join(state,'transaction.json'),JSON.stringify({txId:'ut_abcdefghijkl',targetVersion:'0.9.0-rc.24'}));r=await run();assert.equal(r.skipped,true);assert.equal(r.reason,'update_transaction_active');assert.equal(JSON.parse(fs.readFileSync(path.join(install,'updater/current/manifest.json'))).version,'0.9.0-rc.7');fs.rmSync(path.join(state,'transaction.json'));
  r=await reconcileHelperAfterCoreHealth({mode:'server-managed',platform:'linux',version:'0.9.0-rc.24',coreRoot:core,installRoot:install,stateDir:state});assert.equal(r.skipped,true);assert.equal(r.reason,'server-managed');
  console.log('v10-update-helper-post-health-reconcile=PASS');
  console.log('v10-update-helper-same-version-build-reconcile=PASS');
  console.log('v10-update-helper-no-downgrade=PASS');
  console.log('v10-update-helper-transaction-owner=PASS');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
