import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const installer=read('client/windows-native/installer/GptOperator.iss');
const task=read('device-agent/install-windows-task.ps1');
const watchdog=read('client/windows-native/installer/InstallTransactionWatchdog.ps1');
const expect=(ok,msg)=>{if(!ok)throw new Error(msg);};

const runSection=(installer.match(/\[Run\]([\s\S]*?)\[Code\]/)||[])[1]||'';
expect(!runSection.includes('install-windows-task.ps1'),'task_script_must_be_transaction_managed');
for(const token of [
  'InstallTransactionStarted','InstallTransactionCommitted',
  'PrepareInstallerTransaction();','CaptureAgentTaskRecovery();','StartInstallerWatchdog();',
  'RunAgentInstallTransaction();','InstallerTxnCommitMarker',
  "SaveStringToFile(InstallerTxnCommitMarker, 'commit', False)",
  'procedure DeinitializeSetup()','light-remote-install-transaction-abort-watchdog-armed',
  'InstallerTxnFailpoint','InstallTransactionWatchdog.ps1'
])expect(installer.includes(token),`installer_contract_missing:${token}`);

const seq=[
  '  PrepareInstallerTransaction();','  CaptureAgentTaskRecovery();','  StartInstallerWatchdog();',
  '  InstallTransactionStarted := True;','  StopAndRemoveLegacyTask();','  QuiesceInstalledRuntime();'
].map(x=>installer.indexOf(x));
expect(seq.every((x,i)=>x>=0&&(i===0||x>seq[i-1])),'watchdog_must_arm_before_quiesce');
expect(installer.includes("InstallerTxnWatchdogTask: String;"),'per_pid_watchdog_task_var_required');
expect(installer.includes("LightRemoteInstallWatchdog-"),'per_pid_watchdog_task_name_required');
expect(installer.includes("IntToStr(GetCurrentProcessId())"),'per_pid_transaction_state_required');
expect(installer.includes("-WatchdogTask"),'watchdog_task_name_must_be_explicit');
const commitPos=installer.indexOf("SaveStringToFile(InstallerTxnCommitMarker, 'commit', False)");
const cachePos=installer.indexOf('CacheRollbackInstaller();',commitPos);
expect(commitPos>=0&&cachePos>commitPos,'rollback_anchor_must_refresh_only_after_commit');
const cacheStart=installer.indexOf('procedure CacheRollbackInstaller();');
const cacheEnd=installer.indexOf('function PrepareToInstall',cacheStart);
const cache=cacheStart>=0&&cacheEnd>cacheStart?installer.slice(cacheStart,cacheEnd):'';
expect(cache.includes('for Attempt := 1 to 6 do')&&cache.includes('Cached := CopyFile(SourceInstaller, RollbackFile, False)')&&cache.includes('Cached and FileExists(RollbackFile)')&&cache.includes('light-remote-rollback-cache-retry')&&cache.includes('light-remote-rollback-cache-ready')&&cache.includes('Unable to cache rollback installer'),'rollback_cache_must_retry_verify_and_fail_closed');

const deinit=(installer.match(/procedure DeinitializeSetup\(\);([\s\S]*?)\[UninstallRun\]/)||[])[1]||'';
expect(!deinit.includes('RestoreAgentTaskRecovery();'),'installer_process_must_not_own_abort_recovery');

const stop=(installer.match(/procedure StopAndRemoveLegacyTask\(\);([\s\S]*?)procedure PrepareInstallerTransaction\(\);/)||[])[1]||'';
expect(stop.includes('/End /TN "LightRemoteDeviceAgent"'),'current_task_must_stop');
expect(!stop.includes('/Delete /TN "LightRemoteDeviceAgent"'),'current_task_must_survive_precommit');
expect(stop.includes('legacy-task-delete attempt=')&&stop.includes('/Delete /TN "GPTOperatorDeviceAgent" /F'),'legacy_task_preclean_retry_required');
expect(task.includes('windows-legacy-task-neutralized=PASS')&&task.includes('$legacyActionExpected')&&task.includes('$LegacyLauncher'),'legacy_task_acl_tombstone_guard_required');
expect(task.includes("Start-Process -FilePath $schtasks -ArgumentList @('/Delete','/TN',$Legacy,'/F') -WindowStyle Hidden -Wait -PassThru")&&task.includes('$legacyDeleteExit=$legacyDeleteProcess.ExitCode'),'legacy_task_acl_delete_must_capture_exit_without_native_stderr_abort');

for(const token of [
  'Register-ScheduledTask','Start-ScheduledTask','InstallerPid','CommitMarker','TaskXml',
  'recovery_begin','Light-Remote-MCP-Setup-','rollback_begin','rollback_restore_wall_healthy',
  'Unregister-ScheduledTask'
])expect(watchdog.includes(token),`watchdog_contract_missing:${token}`);

for(const token of [
  "Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5491/'",
  '$wallStable -ge 2','Light Remote Local Wall health gate: PASS'
])expect(task.includes(token),`wall_health_missing:${token}`);

console.log('v10-installer-transaction-watchdog=PASS');
