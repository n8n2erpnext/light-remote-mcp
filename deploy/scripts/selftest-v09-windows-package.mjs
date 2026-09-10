import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../../.github/workflows/windows-agent-dev-build.yml',import.meta.url),'utf8');
const installer=fs.readFileSync(new URL('../../device-agent/install-windows-service.ps1',import.meta.url),'utf8');
const setup=fs.readFileSync(new URL('../../device-agent/setup-windows-dev.ps1',import.meta.url),'utf8');

function expect(condition,message){if(!condition)throw new Error(message);}
expect(/runs-on:\s*windows-latest/.test(workflow),'windows_runner_missing');
expect(/node-version:\s*'22\.23\.2'/.test(workflow),'node_version_not_pinned');
expect(workflow.includes('WinSW-x64.exe'),'winsw_asset_missing');
expect(workflow.includes('05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'),'winsw_hash_not_pinned');
expect(workflow.includes('actions/upload-artifact@v4'),'artifact_upload_missing');
expect(workflow.includes('GPT-Operator-Agent-Windows-x64-dev.zip'),'windows_zip_missing');
expect(installer.includes('New-Service -Name $ServiceName'),'windows_service_install_missing');
expect(installer.includes('-Credential $ServiceCredential'),'service_user_credential_missing');
expect(!/LocalSystem/i.test(installer),'localsystem_must_not_be_used');
expect(!/<password>/i.test(installer),'service_password_must_not_be_written_to_xml');
expect(installer.includes('USERPROFILE'),'service_userprofile_missing');
expect(installer.includes('icacls.exe'),'state_acl_hardening_missing');
expect(setup.includes('Start-Process $url'),'approval_browser_open_missing');
expect(setup.includes("Get-Service -Name 'GPTOperatorDeviceAgent'"),'setup_service_health_missing');
console.log('v09-windows-package-contract=PASS');
