import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const exe=String(process.argv[2]||process.env.LIGHT_REMOTE_CLIENT_EXE||'').trim();
if(process.platform!=='win32'){console.log('windows-capability-refresh=SKIP windows-only');process.exit(0);}
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
    policyProfile:'full',
    certificate:{approvedCapabilities:['filesystem','git']}
  },
  policy:{knownCapabilities:['filesystem','git','terminal','desktop','desktop-input'],deniedCapabilities:[],serverPolicyRevision:3,localFinalDenyBoundary:true},
  pendingEnrollment:{enrollmentId:'en_stale_reauth_test',pollToken:'stale-token-aaaaaaaaaaaaaaaaaaaa',requestedCapabilities:['filesystem','git','terminal','desktop','desktop-input']},
  cloud:{desiredConnected:false,state:'dormant',lastError:null},
  effectiveCapabilities:['filesystem','git','terminal','desktop','desktop-input']
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
  const supported=new Set(view.supportedCapabilities||[]),grantable=new Set(view.grantableCapabilities||[]),denied=new Set(view.deniedCapabilities||[]),effective=new Set(view.effectiveCapabilities||[]);
  for(const cap of ['terminal','desktop','desktop-input']){
    if(!supported.has(cap))throw new Error('capability_refresh_support_missing:'+cap);
    if(!grantable.has(cap))throw new Error('capability_refresh_permission_missing:'+cap);
    if(!denied.has(cap))throw new Error('capability_refresh_new_permission_must_default_off:'+cap);
    if(effective.has(cap))throw new Error('capability_refresh_new_permission_auto_enabled:'+cap);
  }
  if(view.deviceId!==state.enrollment.deviceId)throw new Error('capability_refresh_device_identity_changed');
  if(view.pendingEnrollmentId!==null)throw new Error('capability_refresh_stale_pending_not_cleared');
  if('capabilityUpgradeAvailable' in view||'missingCapabilities' in view)throw new Error('capability_refresh_must_not_use_reauthorization_model');
  const migrated=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(migrated.pendingEnrollment)throw new Error('capability_refresh_stale_pending_persisted');
  if(Number(migrated.policy?.capabilityPermissionModelVersion)!==2)throw new Error('capability_refresh_policy_model_not_migrated');
  for(const cap of ['terminal','desktop','desktop-input'])if(!migrated.policy?.deniedCapabilities?.includes(cap))throw new Error('capability_refresh_migration_not_default_off:'+cap);
  console.log('windows-capability-refresh-same-identity=PASS deviceId='+view.deviceId);
  console.log('windows-capability-refresh-default-off=PASS new=terminal,desktop,desktop-input');
  console.log('windows-capability-refresh-stale-pending-cleared=PASS');
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
