import { createPlatformAdapter } from '../../device-agent/platform-adapters/index.mjs';

function fakeExists(names){const set=new Set(names);return name=>set.has(name);}
function expect(condition,message){if(!condition)throw new Error(message);}
function hasAll(values,required){return required.every(value=>values.includes(value));}

const linux=createPlatformAdapter({platform:'linux',commandExists:fakeExists(['git','node','docker','lxc','systemctl','sudo','apt'])});
const linuxCaps=linux.discoverCapabilities();
expect(hasAll(linuxCaps,['filesystem','git','build-test','docker','lxd','systemctl','sudo-on-demand','package-manager']),'linux_discovery_failed');
const linuxRequired=linux.inferRequiredCapabilities('sudo docker run --rm x; git status; apt-get update');
expect(hasAll(linuxRequired,['filesystem','docker','git','sudo-on-demand','package-manager']),'linux_inference_failed');
expect(linux.commandFor('printf ok').file==='/bin/bash','linux_shell_failed');

const windows=createPlatformAdapter({platform:'win32',commandExists:fakeExists(['pwsh','git','node','docker','winget','sc.exe','wevtutil','tasklist'])});
const windowsCaps=windows.discoverCapabilities();
expect(hasAll(windowsCaps,['filesystem','powershell','git','build-test','docker','package-manager','windows-services','windows-eventlog','windows-process-network']),'windows_discovery_failed');
expect(!windowsCaps.includes('windows-registry')&&!windowsCaps.includes('windows-services-admin'),'windows_protected_auto_advertised');
const windowsRequired=windows.inferRequiredCapabilities('Get-Service; Set-Service Spooler -StartupType Manual; winget list');
expect(hasAll(windowsRequired,['filesystem','powershell','windows-services','windows-services-admin','package-manager']),'windows_inference_failed');
expect(windows.hardDeny('pwsh -EncodedCommand AAA')==='windows_encoded_powershell_denied','windows_encoded_guard_failed');
expect(windows.hardDeny('reg save HKLM\\SAM C:\\temp\\sam')==='windows_sensitive_hive_denied','windows_hive_guard_failed');
expect(windows.commandFor('Get-Date').file==='pwsh','windows_shell_failed');
try{createPlatformAdapter({platform:'aix',commandExists:()=>false});throw new Error('unsupported_platform_not_rejected');}
catch(error){if(error.message!=='unsupported_platform:aix')throw error;}

console.log('v09-linux-adapter=PASS');
console.log('v09-windows-adapter=PASS');
console.log('v09-protected-capability-default-deny=PASS');
