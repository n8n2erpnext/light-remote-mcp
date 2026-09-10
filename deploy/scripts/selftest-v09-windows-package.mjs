import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../../.github/workflows/windows-agent-dev-build.yml',import.meta.url),'utf8');
const service=fs.readFileSync(new URL('../../device-agent/install-windows-service.ps1',import.meta.url),'utf8');
const task=fs.readFileSync(new URL('../../device-agent/install-windows-task.ps1',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('../../device-agent/setup-windows-dev.ps1',import.meta.url),'utf8');
const rights=fs.readFileSync(new URL('../../device-agent/windows-service-rights.ps1',import.meta.url),'utf8');
function expect(condition,message){if(!condition)throw new Error(message);}

expect(/runs-on:\s*windows-latest/.test(workflow),'windows_runner_missing');
expect(/node-version:\s*'22\.23\.2'/.test(workflow),'node_version_not_pinned');
expect(workflow.includes('WinSW-x64.exe'),'winsw_asset_missing');
expect(workflow.includes('05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'),'winsw_hash_not_pinned');
expect(workflow.includes('actions/upload-artifact@v4'),'artifact_upload_missing');
expect(workflow.includes('GPT-Operator-Agent-Windows-x64-dev.zip'),'windows_zip_missing');
expect(workflow.includes('windows-scheduled-task-interactive-token=PASS'),'scheduled_task_ci_missing');
expect(workflow.includes('install-windows-task.ps1'),'task_installer_not_packaged');
expect(task.includes('New-ScheduledTaskPrincipal'),'task_principal_missing');
expect(task.includes('-LogonType Interactive'),'interactive_logon_missing');
expect(task.includes('-RunLevel Limited'),'least_privilege_missing');
expect(task.includes('New-ScheduledTaskTrigger -AtLogOn'),'logon_trigger_missing');
expect(task.includes('Unregister-ScheduledTask'),'task_replace_cleanup_missing');
expect(task.includes('sc.exe delete $LegacyServiceName'),'legacy_service_cleanup_missing');
expect(task.includes('icacls.exe'),'task_state_acl_hardening_missing');
expect(!/LocalSystem/i.test(task),'task_must_not_use_localsystem');
expect(setup.includes("install-windows-task.ps1"),'setup_not_using_task_installer');
expect(setup.includes("Get-ScheduledTask -TaskName 'GPTOperatorDeviceAgent'"),'setup_task_health_missing');
expect(!setup.includes("Get-Service -Name 'GPTOperatorDeviceAgent'"),'setup_still_requires_service');
expect(setup.includes('No account password or PIN is required'),'setup_passwordless_message_missing');

expect(service.includes('New-Service -Name $ServiceName'),'optional_service_install_missing');
expect(service.includes('-Credential $ServiceCredential'),'service_user_credential_missing');
expect(!/LocalSystem/i.test(service),'localsystem_must_not_be_used');
expect(!/<password>/i.test(service),'service_password_must_not_be_written_to_xml');
expect(service.includes('Grant-GptServiceLogonRight'),'service_logon_right_grant_missing');
expect(service.includes('Get-GptServiceStartDiagnostic'),'service_start_diagnostic_missing');
expect(rights.includes('SeServiceLogonRight'),'service_logon_right_constant_missing');
expect(rights.includes('LsaAddAccountRights'),'lsa_add_account_rights_missing');
expect(!rights.includes('SeDenyServiceLogonRight'),'deny_service_logon_must_not_be_modified');
expect(workflow.includes('windows-service-rights.ps1'),'rights_helper_not_packaged');
expect(workflow.includes('windows-service-logon-right=PASS'),'rights_helper_windows_ci_missing');
expect(workflow.includes('windows-bundled-node-smoke=PASS'),'bundled_node_smoke_missing');
expect(setup.includes('Start-Process $url'),'approval_browser_open_missing');
console.log('v09-windows-package-contract=PASS');
