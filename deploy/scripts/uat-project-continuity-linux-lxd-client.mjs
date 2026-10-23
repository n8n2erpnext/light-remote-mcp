/* Run as lr-cont-agent inside the dedicated LXD UAT only, not root. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectContinuityRequest as request,projectContinuityOwnerConsent as decide}
 from '../../device-agent/project-continuity-client.mjs';
const root=process.env.LIGHT_REMOTE_CONTINUITY_BROKER_ROOT;
assert.equal(process.env.LIGHT_REMOTE_CONTINUITY_ISOLATED_BROKER,'1');
assert.equal(root,'/var/lib/light-remote-continuity');
const mode=process.argv[2];
const readSecret=async()=>{
 let text='';
 for await(const data of process.stdin){
  text+=data.toString('utf8');
  if(text.length>128)throw Error('fixture_input_too_large');
 }
 const secret=text.trim();
 assert.ok(secret.length>=30);
 return secret;
};
for(const suffix of [
 '/private/continuity-owner-private.enc.json',
 '/owner-authority-public.pem',
 '/controller/continuity.db',
 '/controller/owner-authority-public.pem']){
 try{
  fs.readFileSync(root+suffix);
  throw Error('SECURITY_FAILURE_CLIENT_CAN_READ_BROKER_PRIVATE_FILE');
 }catch(error){
  assert.equal(error.code,'EACCES','Unexpected private storage test result');
 }
}
assert.ok(fs.statSync(root+'/owner-broker.sock').isSocket());
assert.equal(fs.statSync(root+'/owner-broker.sock').mode&0o777,0o660);
const projectName='Permanent LXD systemd UAT Project';
if(mode==='seed'){
 const secret=await readSecret();
 const p=await request('createProject',{name:projectName});
 assert.equal(p.memory_enabled,0);
 await request('setModules',{projectId:p.id,memory:true,expectedRevision:1});
 await request('memoryPut',{projectId:p.id,body:'CONTINUITY_LXD_PERSISTENCE_CANARY_2026',sourceRef:'owner:UAT-LXD'});
 const res=await decide({projectId:p.id,enabled:true,principal:'uat-owner',
  password:secret,expectedRevision:2});
 assert.equal(res.remoteReadEnabled,true);
 console.log('LXD_INSTALLED_SYSTEMD_OWNER_CONSENT_SEED_PASS');
}else if(mode==='after-reboot'){
 const secret=await readSecret();
 const projects=await request('listProjects');
 const p=projects.find(x=>x.name===projectName||x.project_name===projectName);
 assert.ok(p,'Missing UAT project after container restart');
 assert.equal(p.remote_read_enabled,1);
 const brief=await request('contextBrief',{projectId:p.id,query:'CONTINUITY_LXD_PERSISTENCE_CANARY_2026',maxChars:2400});
 assert.match(brief.content,/CONTINUITY_LXD_PERSISTENCE_CANARY_2026/);
 await assert.rejects(request('remoteBrief',{projectId:p.id}),/continuity_remote_delegation_required/);
 const res=await decide({projectId:p.id,enabled:false,principal:'uat-owner',
  password:secret,expectedRevision:p.revision});
 assert.equal(res.remoteReadEnabled,false);
 console.log('LXD_INSTALLED_SYSTEMD_REBOOT_MEMORY_REVOKE_PASS');
}else if(mode==='verify-revoked'){
 const projects=await request('listProjects');
 const p=projects.find(x=>x.name===projectName||x.project_name===projectName);
 assert.ok(p);
 assert.equal(p.remote_read_enabled,0);
 const brief=await request('contextBrief',{projectId:p.id,query:'CONTINUITY_LXD_PERSISTENCE_CANARY_2026',maxChars:2400});
 assert.match(brief.content,/CONTINUITY_LXD_PERSISTENCE_CANARY_2026/);
 console.log('LXD_INSTALLED_SYSTEMD_RESTART_REVOKED_STATE_PASS');
}else throw Error('invalid_uat_mode');
console.log('LXD_AGENT_OS_FILE_READ_DENIED_PASS');
