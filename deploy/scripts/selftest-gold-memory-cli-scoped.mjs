import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-scoped-cli-'));
const stateFile=path.join(temp,'device.json');
fs.writeFileSync(stateFile,JSON.stringify({enrollment:{accountId:'owner-test',deviceId:'dev_arm_1'}}),{mode:0o600});
const file=path.join(temp,'gold-wall-modules.sqlite');
const m=createGoldWallModules({file,scopeIdentity:{accountId:'owner-test',deviceId:'dev_arm_1'}});
const run=(input)=>{
  const encoded=Buffer.from(JSON.stringify(input)).toString('base64url');
  const output=execFileSync(process.execPath,['--no-warnings',path.join(root,'device-agent/gold-memory-cli.mjs'),encoded],
    {env:{...process.env,OPERATOR_AGENT_STATE:stateFile},encoding:'utf8',timeout:12000});
  const match=output.match(/LIGHT_REMOTE_GOLD_MEMORY_V1=(.*)/);
  assert.ok(match);
  return JSON.parse(match[1]);
};
try{
  m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const legacy=m.saveCheckpoint({title:'Old HMAC',body:'V1 unassigned',source:'legacy'});
  const scope=m.createMemoryScope({displayName:'Gold actual project',captureMode:'manual'});
  m.bindMemoryScope({scopeId:scope.scopeId,sourceType:'workspace',sourceId:'/work/gold',proofType:'owner_explicit'});
  assert.equal(run({action:'scopes'}).result[0].scopeId,scope.scopeId);
  assert.equal(run({action:'scope_resolve',sourceType:'workspace',sourceId:'/work/gold'}).result.scopeId,scope.scopeId);
  assert.equal(run({action:'scope_resolve',sourceType:'workspace',sourceId:'/work/lightbi'}).result.unassigned,true);
  const saved=run({action:'scope_save',scopeId:scope.scopeId,title:'Gold commit',body:'Tested local scoped CLI',source:'owner-approved'});
  assert.equal(saved.ok,true);
  assert.equal(saved.result.revision,1);
  const read=run({action:'scope_get',scopeId:scope.scopeId,id:saved.result.checkpointId});
  assert.equal(read.result.integrity,'home_ed25519_verified');
  assert.equal(read.result.body,'Tested local scoped CLI');
  const handoff=run({action:'scope_handoff',scopeId:scope.scopeId});
  assert.equal(handoff.result.revision,1);
  assert.equal(handoff.result.checkpoints[0].checkpointId,saved.result.checkpointId);
  const v1=run({action:'get',id:legacy.id});
  assert.equal(v1.result.integrity,'device_hmac_verified');
  assert.equal(run({action:'handoff'}).result.checkpoints[0].id,legacy.id);
  console.log('GOLD_G1_AUTHORIZED_CLI_SCOPE_GET_SAVE_HANDOFF_AND_V1_COMPAT_PASS');
}finally{m.close();fs.rmSync(temp,{recursive:true,force:true});}
