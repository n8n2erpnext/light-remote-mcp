import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLinuxAdapter} from '../../device-agent/platform-adapters/linux.mjs';
import {createWindowsAdapter} from '../../device-agent/platform-adapters/windows.mjs';
import {createMacOSAdapter} from '../../device-agent/platform-adapters/macos.mjs';
import {inferOutboundExecCapabilities} from '../../operator-host/outbound-exec-capabilities.mjs';
import {ensureHostCompanionState} from '../../operator-host/host-device-identity.mjs';
import {EnrollmentRegistry} from '../../operator-host/enrollment-registry.mjs';

const required=['docker','lxd','podman','incus','kubernetes','virtualization','network-admin','firewall','storage-admin','infra-provisioning','package-manager','sudo-on-demand'];
const missing=createLinuxAdapter({commandExists:()=>false});
for(const cap of required)assert(missing.discoverCapabilities().includes(cap),'Linux must support absent '+cap);
assert(!missing.installedCapabilities().includes('lxd'),'availability and authority must differ');
const installed=createLinuxAdapter({commandExists:n=>n==='lxc'||n==='apt'});
assert(installed.installedCapabilities().includes('lxd'));
assert(missing.discoverCapabilities().includes('lxd'));
assert.deepEqual(missing.inferRequiredCapabilities('sudo apt-get install -y lxd'),['filesystem','lxd']);
assert.deepEqual(missing.inferRequiredCapabilities('sudo -n snap install lxd --classic'),['filesystem','lxd']);
assert.deepEqual(missing.inferRequiredCapabilities('sudo apt-get install -y docker.io'),['docker','filesystem']);
assert.deepEqual(missing.inferRequiredCapabilities('sudo apt install -y incus'),['filesystem','incus']);
assert.deepEqual(missing.inferRequiredCapabilities('sudo apt-get install -y podman'),['filesystem','podman']);
const noBypass=['sudo apt install lxd docker.io','sudo apt install lxd && echo x','sudo apt-get install lxd; echo x','sudo apt-get install curl','sudo apt install -o arbitrary=1 lxd','sudo snap install lxd$(id)'];
for(const script of noBypass){
  const list=missing.inferRequiredCapabilities(script);
  assert(list.includes('package-manager'),script+' must require general package-manager');
  assert(list.includes('sudo-on-demand'),script+' must require elevated command authority');
}
for(const [script,cap] of [['podman ps','podman'],['incus list','incus'],['kubectl get pods','kubernetes'],['helm list','kubernetes'],['virsh list','virtualization'],['ip addr','network-admin'],['nft list ruleset','firewall'],['zpool status','storage-admin'],['snap list','package-manager']]){
  assert(missing.inferRequiredCapabilities(script).includes(cap),script+' requires '+cap);
}
for(const script of ['command -v docker','command -v lxc','which kubectl','type -P lxd']){
  assert(!missing.inferRequiredCapabilities(script).includes('docker'));
  assert(!missing.inferRequiredCapabilities(script).includes('lxd'));
}
const sample='sudo apt-get install -y lxd';
assert.deepEqual(inferOutboundExecCapabilities(sample,{platform:'linux',declared:[]}),missing.inferRequiredCapabilities(sample),'Operator/Agent parity');

const mac=createMacOSAdapter({commandExists:()=>false});
assert(mac.discoverCapabilities().includes('docker'));
assert(!mac.installedCapabilities().includes('docker'));
assert.deepEqual(mac.inferRequiredCapabilities('brew install --cask docker'),['docker','filesystem']);
assert(mac.inferRequiredCapabilities('brew install jq').includes('package-manager'));
const win=createWindowsAdapter({commandExists:()=>false});
assert(win.discoverCapabilities().includes('docker'));
assert(!win.installedCapabilities().includes('docker'));
const scopedWin=win.inferRequiredCapabilities('winget install --id Docker.DockerDesktop -e');
assert(scopedWin.includes('docker')&&!scopedWin.includes('package-manager'));
assert(win.inferRequiredCapabilities('winget install curl').includes('package-manager'));

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-infra-cap-'));
try {
 const file=path.join(tmp,'host.json');
 fs.writeFileSync(file,JSON.stringify({enrollment:{deviceId:'main-device',grantableCapabilities:['filesystem']},identity:{publicIdentityKey:'test'},policy:{deniedCapabilities:[]}}));
 const binding={deviceId:'main-device',accountId:'owner',displayName:'main',policyProfile:'full',policyRevision:3,grantableCapabilities:['filesystem','docker','lxd'],approvedCapabilities:['filesystem'],certificate:{},certificateSignature:'',issuedAt:1};
 const state=ensureHostCompanionState(file,{identity:{publicKey:'test',publicKeySha256:'sha',createdAt:1},binding,signer:{publicKey:'x'},nodeId:'main'});
 assert(state.policy.deniedCapabilities.includes('docker'));
 assert(state.policy.deniedCapabilities.includes('lxd'));
 assert.deepEqual(state.effectiveCapabilities,['filesystem']);
 const repeated=ensureHostCompanionState(file,{identity:{publicKey:'test',publicKeySha256:'sha',createdAt:1},binding,signer:{publicKey:'x'},nodeId:'main'});
 assert.deepEqual(repeated.effectiveCapabilities,['filesystem']);

 // A previously owner-approved LXD capability remains even when no LXD binary exists.
 const {publicKey}=crypto.generateKeyPairSync('ed25519');
 const r=new EnrollmentRegistry({stateFile:path.join(tmp,'enroll.json'),signerFile:path.join(tmp,'signer.pem')});
 const pending=r.begin({publicIdentityKey:publicKey.export({format:'der',type:'spki'}).toString('base64'),displayName:'No LXD',platform:'linux',capabilities:missing.discoverCapabilities()});
 const enrolled=r.approve({enrollmentId:pending.enrollmentId,code:pending.deviceCode,accountId:'owner',approvedCapabilities:['filesystem','lxd'],policyProfile:'custom'});
 assert(r.policyView(enrolled.deviceId).approvedCapabilities.includes('lxd'));
 const refreshed=r.refreshDiscoveredCapabilities({deviceId:enrolled.deviceId,accountId:'owner',capabilities:missing.discoverCapabilities()});
 assert(refreshed.policy.approvedCapabilities.includes('lxd'),'missing executable must not remove grant');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
console.log('INFRA_CAPABILITY_CATALOG_PASS supported_vs_installed,preinstall_lxd,scoped_installer,server_parity,main_host_safe_defaults,linux_macos_windows');
