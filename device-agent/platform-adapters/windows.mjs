import { firstAvailable, inferCapabilities, uniqueCapabilities } from './shared.mjs';

const RULES=[
  ['git',/(^|[;&|\s])git(\.exe)?(\s|$)/i],
  ['docker',/(^|[;&|\s])docker(\.exe)?(\s|$)/i],
  ['package-manager',/(^|[;&|\s])(winget|choco)(\.exe)?(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python|py|pip|cargo|rustc)(\.exe)?(\s|$)/i],
  ['windows-services',/\b(Get-Service|sc(?:\.exe)?\s+query)\b/i],
  ['windows-eventlog',/\b(Get-WinEvent|Get-EventLog|wevtutil)\b/i],
  ['windows-process-network',/\b(Get-Process|Get-NetTCPConnection|netstat|tasklist|Get-NetAdapter)\b/i],
  ['windows-registry',/\b(HKLM:|HKCU:|HKCR:|HKU:|Registry::|reg(?:\.exe)?\s+(add|delete|import|restore|load|unload))\b/i],
  ['windows-scheduled-tasks',/\b(Register-ScheduledTask|Unregister-ScheduledTask|schtasks(?:\.exe)?)\b/i],
  ['windows-services-admin',/\b(Set-Service|New-Service|Remove-Service|Restart-Service|Stop-Service|Start-Service|sc(?:\.exe)?\s+(create|delete|config|start|stop))\b/i],
  ['windows-defender-firewall',/\b(Set-MpPreference|Add-MpPreference|Remove-MpPreference|Set-NetFirewall|New-NetFirewall|Remove-NetFirewall|netsh\s+advfirewall)\b/i],
  ['windows-credential-manager',/\b(cmdkey|vaultcmd|Get-StoredCredential|New-StoredCredential|Remove-StoredCredential)\b/i],
  ['windows-uac-admin',/\b(Start-Process\b[^\r\n;]*-Verb\s+RunAs|runas(?:\.exe)?)\b/i]
];

export function createWindowsAdapter({commandExists}) {
  const shell=firstAvailable(commandExists,['pwsh','powershell.exe','powershell']);
  return {
    id:'win32',displayName:'Windows PowerShell adapter',
    discoverCapabilities() {
      const caps=['filesystem'];
      if(shell)caps.push('powershell');
      if(commandExists('git'))caps.push('git');
      if(['node','python','py','cargo'].some(commandExists))caps.push('build-test');
      if(commandExists('docker'))caps.push('docker');
      if(commandExists('winget')||commandExists('choco'))caps.push('package-manager');
      if(commandExists('sc.exe')||commandExists('sc'))caps.push('windows-services');
      if(commandExists('wevtutil'))caps.push('windows-eventlog');
      if(commandExists('tasklist')||commandExists('netstat'))caps.push('windows-process-network');
      return uniqueCapabilities(caps);
    },
    inferRequiredCapabilities(script) {
      return uniqueCapabilities(['filesystem','powershell',...inferCapabilities(script,RULES)]);
    },
    hardDeny(script) {
      const text=String(script||'');
      if(/(?:^|\s)-(?:enc|encodedcommand)\b/i.test(text))return 'windows_encoded_powershell_denied';
      if(/FromBase64String\s*\([^)]*\)/i.test(text)&&/Invoke-Expression|\biex\b/i.test(text))return 'windows_obfuscated_powershell_denied';
      if(/\\(SAM|SECURITY)(?:\\|\b)/i.test(text)||/HKLM:\\SAM|HKLM:\\SECURITY/i.test(text))return 'windows_sensitive_hive_denied';
      return null;
    },
    commandFor(script) {
      if(!shell)throw new Error('powershell_unavailable');
      return {file:shell,args:['-NoLogo','-NoProfile','-NonInteractive','-Command',String(script||'')]};
    }
  };
}
