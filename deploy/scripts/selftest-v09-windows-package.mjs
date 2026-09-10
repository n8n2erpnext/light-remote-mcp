import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../../.github/workflows/windows-native-client.yml',import.meta.url),'utf8');
const project=fs.readFileSync(new URL('../../client/windows-native/GptOperator.Client/GptOperator.Client.csproj',import.meta.url),'utf8');
const form=fs.readFileSync(new URL('../../client/windows-native/GptOperator.Client/MainForm.cs',import.meta.url),'utf8');
const supervisor=fs.readFileSync(new URL('../../client/windows-native/GptOperator.Client/AgentSupervisor.cs',import.meta.url),'utf8');
const updater=fs.readFileSync(new URL('../../client/windows-native/GptOperator.Client/UpdateClient.cs',import.meta.url),'utf8');
const installer=fs.readFileSync(new URL('../../client/windows-native/installer/GptOperator.iss',import.meta.url),'utf8');
function expect(condition,message){if(!condition)throw new Error(message);}

expect(/runs-on:\s*windows-latest/.test(workflow),'windows_runner_missing');
expect(workflow.includes("dotnet-version: '8.0.x'"),'dotnet_not_pinned');
expect(workflow.includes("node-version: '22.23.2'"),'node_not_pinned');
expect(workflow.includes('windows-native-installer-roundtrip=PASS'),'installer_roundtrip_missing');
expect(workflow.includes('windows-native-update-signature=PASS'),'signed_update_ci_missing');
expect(workflow.includes('GPT-Operator-Setup-x64.exe'),'native_setup_artifact_missing');
expect(!workflow.includes('START-HERE.ps1'),'powershell_user_flow_returned');
expect(project.includes('<UseWindowsForms>true</UseWindowsForms>'),'native_winforms_missing');
expect(project.includes('<SelfContained>true</SelfContained>'),'self_contained_missing');
expect(project.includes('<PublishSingleFile>true</PublishSingleFile>'),'single_file_shell_missing');
expect(form.includes('NotifyIcon'),'tray_icon_missing');
expect(form.includes('Still connected in the system tray'),'close_to_tray_missing');
expect(form.includes('Software\\Microsoft\\Windows\\CurrentVersion\\Run'),'autostart_missing');
expect(form.includes('Enroll device'),'native_enrollment_ui_missing');
expect(supervisor.includes('operator-agent.mjs')||supervisor.includes('AppPaths.AgentScript'),'agent_supervision_missing');
expect(supervisor.includes('StartDaemon'),'daemon_supervisor_missing');
expect(supervisor.includes('Math.Min(30'),'restart_backoff_missing');
expect(updater.includes('VerifySignedManifest'),'signed_manifest_verify_missing');
expect(updater.includes('DSASignatureFormat.Rfc3279DerSequence'),'windows_ecdsa_der_format_missing');
expect(updater.includes('CryptographicOperations.FixedTimeEquals'),'artifact_hash_constant_time_missing');
expect(installer.includes('PrivilegesRequired=lowest'),'per_user_installer_missing');
expect(installer.includes('{localappdata}\\Programs\\GPT Operator'),'localappdata_install_missing');
expect(installer.includes('uninsdeletevalue'),'autostart_uninstall_cleanup_missing');
expect(!/LocalSystem/i.test(installer),'installer_must_not_use_localsystem');
expect(fs.existsSync(new URL('../../client/update-public.pem',import.meta.url)),'update_public_key_missing');
expect(fs.existsSync(new URL('../../deploy/fixtures/client-update-test.json.sig',import.meta.url)),'signed_update_fixture_missing');
console.log('v09-windows-native-package-contract=PASS');
