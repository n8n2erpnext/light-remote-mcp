import { firstAvailable, inferCapabilities, uniqueCapabilities } from './shared.mjs';

function scopedInstaller(script){
  const m=/^[ \t]*(?:winget(?:\.exe)?|choco(?:\.exe)?)[ \t]+install[ \t]+(?:(?:--id|-e|--exact)[ \t]+)?(Docker\.DockerDesktop|Docker\.DockerCLI|docker-desktop|kubectl|helm|Kubernetes\.kubectl)(?:[ \t]+(?:-e|--exact|--silent))?[ \t]*$/i.exec(String(script||''));
  if(!m)return null;
  return /kubectl|helm/i.test(m[1])?'kubectl':'docker';
}
const RULES=[
  ['git',/(^|[;&|\s])git(\.exe)?(\s|$)/i],
  ['docker',/(^|[;&|\s])(docker|docker-compose)(\.exe)?(\s|$)/i],
  ['package-manager',/(^|[;&|\s])(winget|choco)(\.exe)?(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python|py|pip|cargo|rustc)(\.exe)?(\s|$)/i],
  ['windows-services',/\b(Get-Service|sc(?:\.exe)?\s+query)\b/i],
  ['windows-eventlog',/\b(Get-WinEvent|Get-EventLog|wevtutil)\b/i],
  ['windows-process-network',/\b(Get-Process|Get-NetTCPConnection|netstat|tasklist|Get-NetAdapter)\b/i],
  // A colon is not a word boundary before '\\'; HKLM:\\ previously went
  // unclassified. Registry authority remains separately grant-controlled.
  ['windows-registry',/(?:\b(?:HKLM|HKCU|HKCR|HKU):|Registry::|\breg(?:\.exe)?\s+(?:add|delete|import|restore|load|unload)\b)/i],
  ['windows-scheduled-tasks',/\b(Register-ScheduledTask|Unregister-ScheduledTask|schtasks(?:\.exe)?)\b/i],
  ['windows-services-admin',/\b(Set-Service|New-Service|Remove-Service|Restart-Service|Stop-Service|Start-Service|sc(?:\.exe)?\s+(create|delete|config|start|stop))\b/i],
  ['windows-defender-firewall',/\b(?:Set-MpPreference|Add-MpPreference|Remove-MpPreference|(?:Set|New|Remove)-NetFirewall(?:Rule|Profile|AddressFilter|PortFilter|ApplicationFilter|ServiceFilter|SecurityFilter)?|netsh\s+advfirewall)\b/i],
  ['windows-credential-manager',/\b(cmdkey|vaultcmd|Get-StoredCredential|New-StoredCredential|Remove-StoredCredential)\b/i],
  ['windows-uac-admin',/\b(Start-Process\b[^\r\n;]*-Verb\s+RunAs|runas(?:\.exe)?)\b/i],
  ['kubernetes',/\b(kubectl|helm|kind|minikube)(?:\.exe)?\b/i],
  ['virtualization',/\b(docker-machine|VBoxManage|virsh|wsl(?:\.exe)?|vmrun|Get-VM|New-VM|Start-VM|Stop-VM)\b/i],
  ['network-admin',/\b(New-NetIPAddress|Set-NetIPAddress|Remove-NetIPAddress|Set-DnsClientServerAddress|Disable-NetAdapter|Enable-NetAdapter|Set-NetAdapter|netsh\s+interface)\b/i],
  ['infra-provisioning',/\b(terraform|tofu|ansible|packer|pulumi|vagrant)(?:\.exe)?\b/i],
  ['storage-admin',/\b(Initialize-Disk|New-Partition|Remove-Partition|Format-Volume|Resize-Partition|diskpart(?:\.exe)?)\b/i]
];

export function createWindowsAdapter({commandExists}) {
  const shell=firstAvailable(commandExists,['pwsh','powershell.exe','powershell']);
  const cmd=firstAvailable(commandExists,['cmd.exe','cmd']);
  let installedCache=null,installedCacheUntil=0;
  return {
    id:'win32',displayName:'Windows PowerShell adapter',
    discoverCapabilities(){return uniqueCapabilities(['filesystem','powershell','terminal','git','build-test','docker','package-manager','windows-services','windows-services-admin','windows-eventlog','windows-process-network','windows-registry','windows-scheduled-tasks','windows-defender-firewall','windows-credential-manager','windows-uac-admin','kubernetes','virtualization','network-admin','storage-admin','infra-provisioning']);},
    installedCapabilities(){
      if(installedCache&&Date.now()<installedCacheUntil)return [...installedCache];
      const caps=['filesystem'];
      const test=(cap,names)=>{if(names.some(commandExists))caps.push(cap);};
      if(shell)caps.push('powershell');
      if(shell||cmd)caps.push('terminal');
      test('git',['git']);test('build-test',['node','python','py','cargo']);test('docker',['docker']);
      test('package-manager',['winget','choco']);test('windows-services',['sc.exe','sc']);
      test('windows-services-admin',['sc.exe','sc']);test('windows-eventlog',['wevtutil']);
      test('windows-process-network',['tasklist','netstat']);test('windows-registry',['reg.exe']);
      test('windows-scheduled-tasks',['schtasks.exe']);test('windows-defender-firewall',['netsh.exe']);
      test('windows-credential-manager',['cmdkey.exe']);test('windows-uac-admin',['runas.exe']);
      test('kubernetes',['kubectl','helm']);test('virtualization',['wsl.exe','VBoxManage.exe']);
      test('network-admin',['netsh.exe']);test('storage-admin',['diskpart.exe']);test('infra-provisioning',['terraform.exe','tofu.exe','pulumi.exe']);
      installedCache=uniqueCapabilities(caps);
      installedCacheUntil=Date.now()+60_000;
      return [...installedCache];
    },
    invalidateInstalledCapabilities(){installedCache=null;installedCacheUntil=0;},
    inferRequiredCapabilities(script,{shell:requestedShell='default'}={}) {
      // An explicitly selected cmd.exe shell must not require the separate
      // PowerShell capability; it requires terminal shell authority instead.
      const shellCapability=String(requestedShell||'default').toLowerCase()==='cmd'
       ?'terminal':'powershell';
      return uniqueCapabilities(['filesystem',shellCapability,...inferCapabilities(scopedInstaller(script)||script,RULES)]);
    },
    hardDeny(script) {
      const text=String(script||'');
      if(/(?:^|\s)-(?:enc|encodedcommand)\b/i.test(text))return 'windows_encoded_powershell_denied';
      if(/FromBase64String\s*\([^)]*\)/i.test(text)&&/Invoke-Expression|\biex\b/i.test(text))return 'windows_obfuscated_powershell_denied';
      if(/\\(SAM|SECURITY)(?:\\|\b)/i.test(text)||/HKLM:\\SAM|HKLM:\\SECURITY/i.test(text))return 'windows_sensitive_hive_denied';
      return null;
    },
    shellModes() {
      const modes=['default'];if(shell)modes.push('powershell');if(cmd)modes.push('cmd');return modes;
    },
    commandFor(script,{shell:requestedShell='default'}={}) {
      const requested=String(requestedShell||'default').trim().toLowerCase();
      if(requested==='cmd'){if(!cmd)throw new Error('cmd_unavailable');return {file:cmd,args:['/d','/s','/c',String(script||'')]};}
      if(!['default','powershell'].includes(requested))throw new Error(`windows_shell_unsupported:${requested}`);
      if(!shell)throw new Error('powershell_unavailable');
      return {file:shell,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',String(script||'')]};
        },
    terminalFor({shell:requestedShell='default'}={}) {
      const requested=String(requestedShell||'default').trim().toLowerCase();
      if(requested==='cmd'){if(!cmd)throw new Error('cmd_unavailable');return {file:cmd,args:['/d'],shell:'cmd'};}
      if(!['default','powershell'].includes(requested))throw new Error(`windows_shell_unsupported:${requested}`);
      if(!shell)throw new Error('powershell_unavailable');
      return {file:shell,args:['-NoLogo'],shell:'powershell'};
    }
  };
}
