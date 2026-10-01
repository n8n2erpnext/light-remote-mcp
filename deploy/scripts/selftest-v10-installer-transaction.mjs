import fs from 'node:fs';

const root=new URL('../../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const installer=read('client/windows-native/installer/GptOperator.iss');
const task=read('device-agent/install-windows-task.ps1');
const expect=(ok,msg)=>{if(!ok)throw new Error(msg);};

const runSection=(installer.match(/\[Run\]([\s\S]*?)\[Code\]/)||[])[1]||'';
expect(!runSection.includes('install-windows-task.ps1'),'installer_task_script_must_be_code_managed');
for(const token of [
  'InstallTransactionStarted',
  'InstallTransactionCommitted',
  'CaptureAgentTaskRecovery();',
  'RestoreAgentTaskRecovery();',
  'RunAgentInstallTransaction();',
  'procedure DeinitializeSetup()',
  'light-remote-install-transaction-abort-recovery',
  'InstallerTxnFailpoint'
])expect(installer.includes(token),`installer_transaction_contract_missing:${token}`);

const stopBlock=(installer.match(/procedure StopAndRemoveLegacyTask\(\);([\s\S]*?)procedure CaptureAgentTaskRecovery\(\);/)||[])[1]||'';
expect(stopBlock.includes('/End /TN \"LightRemoteDeviceAgent\"'),'current_agent_task_must_be_stopped');
expect(!stopBlock.includes('/Delete /TN \"LightRemoteDeviceAgent\"'),'current_agent_task_must_survive_precommit');
expect(installer.includes('Export-ScheduledTask -TaskName \'\'LightRemoteDeviceAgent\'\''),
  'agent_task_xml_backup_missing');
expect(installer.includes('/Create /TN \"LightRemoteDeviceAgent\" /XML'),
  'agent_task_xml_restore_missing');
expect(installer.includes('InstallTransactionCommitted := True;'),
  'installer_commit_marker_missing');

for(const token of [
  "Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5491/'",
  '$wallStable -ge 2',
  'Light Remote Local Wall health gate: PASS'
])expect(task.includes(token),`installer_wall_health_missing:${token}`);

console.log('v10-installer-transaction-static=PASS');
