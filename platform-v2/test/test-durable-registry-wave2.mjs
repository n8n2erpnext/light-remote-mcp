import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {UsageRegistry} from '../../operator-host/usage-registry.mjs';
import {AccountNotificationRegistry} from '../../operator-host/account-notification-registry.mjs';
import {FreeBenefitRegistry} from '../../operator-host/free-benefit-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {LicenseKeyRegistry} from '../../operator-host/license-key-registry.mjs';
import {AgentClientRegistry} from '../../operator-host/agent-client-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {SupportOutbox} from '../../plugin-server/support-backoffice.mjs';

test('rc50 wave2: eight real dev registry modules persist and reload local fake state',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-reg-wave2-'));
 try{
  const file=n=>path.join(dir,n+'.json');
  const usage=new UsageRegistry({stateFile:file('usage'),now:()=>1750000000000});
  assert.equal(usage.ingest({type:'session_activity',action:'toolCalls',
   accountId:'uat_account',deviceId:'uat_device',at:1750000000000}),true);
  assert.equal(JSON.parse(fs.readFileSync(file('usage'))).schemaVersion,1);
  assert.equal(new UsageRegistry({stateFile:file('usage')}).loadError,null);
  const notification=new AccountNotificationRegistry({stateFile:file('notice'),now:()=>1750000000000});
  notification.publish({type:'feature',title:'Test notice',body:'Synthetic notice only'});
  assert.equal(new AccountNotificationRegistry({stateFile:file('notice')}).messages.length,1);
  const benefit=new FreeBenefitRegistry({stateFile:file('benefit'),mode:'shadow'});
  benefit._save();
  assert.equal(new FreeBenefitRegistry({stateFile:file('benefit')}).mode,'shadow');
  const team=new ProTeamRegistry({stateFile:file('team')});
  team._save();
  assert.equal(new ProTeamRegistry({stateFile:file('team')}).teams.size,0);
  const license=new LicenseKeyRegistry({stateFile:file('license')});
  const issued=license.issue({plan:'pro',durationDays:7,maxRedemptions:1});
  assert.equal(new LicenseKeyRegistry({stateFile:file('license')})
     .inspect(issued.key).licenseId,issued.license.licenseId);
  const agent=new AgentClientRegistry({stateFile:file('agent')});
  agent._persist();
  assert.equal(new AgentClientRegistry({stateFile:file('agent')}).rows.size,0);
  const grant=new DeviceAccessGrantRegistry({stateFile:file('grant')});
  grant._persist();
  assert.equal(new DeviceAccessGrantRegistry({stateFile:file('grant')}).grants.size,0);
  const support=new SupportOutbox({stateFile:file('support'),configFile:file('support-config'),
    fetchImpl:async()=>{throw Error('unexpected network');}});
  support.rows.push({eventId:'uat_evt_1234',accountId:'uat_account',payload:{fake:true}});
  support._persist();
  assert.equal(new SupportOutbox({stateFile:file('support'),configFile:file('support-config'),
    fetchImpl:async()=>{throw Error('unexpected network');}}).rows.length,1);
  for(const name of ['usage','notice','benefit','team','license','agent','grant','support']){
   const fn=file(name);
   assert.equal(fs.statSync(fn).mode&0o777,0o600);
   assert.equal(fs.statSync(fn).nlink,1);
   assert.ok(fs.lstatSync(fn).isFile());
  }
  assert.ok(fs.readdirSync(dir).every(n=>!n.endsWith('.tmp')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rc50 wave2: actual site-announcement writer fsync mode 0640 and survives a fresh process',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-site-wave2-'));
 try{
  const file=path.join(dir,'site-content.json');
  const moduleUrl=new URL('../../plugin-server/site-announcements.mjs',import.meta.url).href;
  const env={...process.env,LIGHT_REMOTE_SITE_CONTENT_PATH:file};
  const add=`import {mutateAnnouncement} from ${JSON.stringify(moduleUrl)};
   const x=mutateAnnouncement('POST',null,{title:'Fixture',message:'Disposable only'});
   if(x.title!=='Fixture')process.exit(3);`;
  const first=spawnSync(process.execPath,['--input-type=module','-e',add],
    {env,encoding:'utf8',timeout:6000});
  assert.equal(first.status,0,first.stderr);
  assert.equal(fs.statSync(file).mode&0o777,0o640);
  const check=`import {listAnnouncements} from ${JSON.stringify(moduleUrl)};
   if(!listAnnouncements().some(x=>x.title==='Fixture'))process.exit(4);`;
  const second=spawnSync(process.execPath,['--input-type=module','-e',check],
    {env,encoding:'utf8',timeout:6000});
  assert.equal(second.status,0,second.stderr);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
