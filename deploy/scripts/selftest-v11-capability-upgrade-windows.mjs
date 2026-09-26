import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const exe=String(process.argv[2]||process.env.LIGHT_REMOTE_CLIENT_EXE||'').trim();
if(process.platform!=='win32')throw new Error('windows_only');
if(!exe||!fs.existsSync(exe))throw new Error('real_remote_helper_missing');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-cap-upgrade-'));
const stateFile=path.join(dir,'device.json');
const agent=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const state={
  enrollment:{
    enrollmentId:'en_legacy_real_remote_test',
    deviceId:'dev_legacy_real_remote_test',
    nodeId:'dev_legacy_real_remote_test',
    accountId:'self-hosted-local',
    grantableCapabilities:['filesystem','git'],
    approvedCapabilities:['filesystem','git'],
    policyProfile:'full'
  },
  policy:{deniedCapabilities:[],serverPolicyRevision:3,localFinalDenyBoundary:true},
  effectiveCapabilities:['filesystem','git']
};
fs.writeFileSync(stateFile,JSON.stringify(state,null,2));
try{
  const run=spawnSync(process.execPath,[agent,'status'],{
    env:{...process.env,OPERATOR_AGENT_STATE:stateFile,LIGHT_REMOTE_REAL_REMOTE:'1',LIGHT_REMOTE_CLIENT_EXE:exe},
    encoding:'utf8',timeout:15000,windowsHide:true
  });
  if(run.error)throw run.error;
  if(run.status!==0)throw new Error('capability_upgrade_status_failed:'+String(run.stderr||run.stdout||''));
  let view;try{view=JSON.parse(String(run.stdout||''));}catch{throw new Error('capability_upgrade_status_json_invalid:'+String(run.stdout||''));}
  const discovered=new Set(view.discoveredCapabilities||[]),missing=new Set(view.missingCapabilities||[]);
  for(const cap of ['desktop','desktop-input']){
    if(!discovered.has(cap))throw new Error('capability_upgrade_discovery_missing:'+cap);
    if(!missing.has(cap))throw new Error('capability_upgrade_drift_missing:'+cap);
  }
  if(view.capabilityUpgradeAvailable!==true)throw new Error('capability_upgrade_flag_missing');
  if(view.capabilityUpgradePending!==false)throw new Error('capability_upgrade_pending_unexpected');
  if((view.grantableCapabilities||[]).includes('desktop')||(view.effectiveCapabilities||[]).includes('desktop'))throw new Error('capability_upgrade_must_fail_closed_before_reauth');
  console.log('windows-capability-upgrade-discovery=PASS missing='+[...missing].join(','));
  console.log('windows-capability-upgrade-fail-closed=PASS');
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
