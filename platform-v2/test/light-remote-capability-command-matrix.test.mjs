import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformAdapter} from '../../device-agent/platform-adapters/index.mjs';

const all=()=>true,adapter=p=>createPlatformAdapter({platform:p,commandExists:all});
const cases={
 linux:[
  ['docker info',['docker']],['docker-compose version',['docker']],
  ['/usr/bin/docker info',['docker']],['/usr/local/bin/docker ps',['docker']],
  ['sudo /usr/bin/docker info',['sudo-on-demand','docker']],
  ['lxc list',['lxd']],['/usr/bin/lxc list',['lxd']],
  ['/usr/bin/systemctl status cron',['systemctl']],
  ['/usr/bin/sudo -n true',['sudo-on-demand']],
  ['/usr/bin/apt-cache policy',['package-manager']],
  ['/usr/bin/git status',['git']],
  ['/usr/bin/node --version',['build-test']],
  ['/usr/local/bin/npm --version',['build-test']],
  ['systemctl status ssh',['systemctl']],['journalctl -n 2',['systemctl']],
  ['sudo -n true',['sudo-on-demand']],
  ['apt-get -v',['package-manager']],['git status',['git']],
  ['npm test',['build-test']],['node --version',['build-test']],
 ],
 win32:[
  ['docker info',['docker']],['docker.exe info',['docker']],
  ['docker-compose.exe version',['docker']],
  ['Get-Service',['windows-services']],
  ['Set-Service Spooler -StartupType Manual',['windows-services-admin']],
  ['Get-NetAdapter',['windows-process-network']],
  ['Get-NetTCPConnection',['windows-process-network']],
  ['Get-WinEvent -MaxEvents 1',['windows-eventlog']],
  ['Get-Item HKLM:\\SOFTWARE',['windows-registry']],
  ['Set-ItemProperty -Path HKLM:\\SOFTWARE -Name X -Value 1',['windows-registry']],
  ['Register-ScheduledTask -TaskName X',['windows-scheduled-tasks']],
  ['Set-NetFirewallProfile -Enabled False',['windows-defender-firewall']],
  ['New-NetFirewallRule -DisplayName X',['windows-defender-firewall']],
  ['Remove-NetFirewallRule -DisplayName X',['windows-defender-firewall']],
  ['Start-Process powershell -Verb RunAs',['windows-uac-admin']],
  ['winget list',['package-manager']],
  ['npm test',['build-test']],
 ],
 darwin:[
  ['docker info',['docker']],['/usr/local/bin/docker info',['docker']],
  ['/opt/homebrew/bin/docker ps',['docker']],['brew list',['package-manager']],
  ['/opt/homebrew/bin/brew list',['package-manager']],
  ['/usr/bin/sudo -n true',['sudo-on-demand']],
  ['/bin/launchctl list',['macos-services']],
  ['/usr/bin/log show --last 1m',['macos-log']],
  ['/usr/bin/git status',['git']],
  ['launchctl print system',['macos-services']],
  ['log show --last 1m',['macos-log']],
  ['sudo -n true',['sudo-on-demand']],['git status',['git']],
  ['xcodebuild -version',['build-test']]
 ]
};
test('Linux Windows and macOS command-family classification matrix does not silently miss established capabilities',()=>{
 for(const [platform,rows] of Object.entries(cases)){
  const a=adapter(platform);
  for(const [script,expected] of rows){
   const got=a.inferRequiredCapabilities(script);
   for(const cap of expected)
    assert(got.includes(cap),platform+': '+JSON.stringify(script)+' missing '+cap+
     ' (actual '+got.join(',')+')');
  }
 }
});
test('Windows explicit cmd shell requires terminal, not unrelated PowerShell permission',()=>{
 const a=adapter('win32');
 assert(a.inferRequiredCapabilities('echo ok',{shell:'cmd'}).includes('terminal'));
 assert(!a.inferRequiredCapabilities('echo ok',{shell:'cmd'}).includes('powershell'));
 assert(a.inferRequiredCapabilities('echo ok',{shell:'powershell'}).includes('powershell'));
 assert(a.inferRequiredCapabilities('echo ok').includes('powershell'));
 assert(a.inferRequiredCapabilities('sc.exe query',{shell:'cmd'}).includes('windows-services'));
 assert(a.inferRequiredCapabilities('sc.exe delete demo',{shell:'cmd'}).includes('windows-services-admin'));
});
test('Protected Windows capabilities remain unadvertised without explicit policy support',()=>{
 const a=adapter('win32');
 const discovered=a.discoverCapabilities();
 for(const cap of ['windows-registry','windows-services-admin',
  'windows-scheduled-tasks','windows-defender-firewall',
  'windows-credential-manager','windows-uac-admin']){
  assert(!discovered.includes(cap),
   cap+' must not be granted by automatic command discovery');
 }
 assert(a.hardDeny('pwsh -EncodedCommand AAA'));
 assert(a.hardDeny('reg save HKLM\\SAM C:\\temp\\sam'));
});
test('Local capability inference is checked independently of a caller-supplied filesystem-only request',()=>{
 const linux=adapter('linux'),mac=adapter('darwin'),win=adapter('win32');
 for(const [a,command,cap] of [
  [linux,'/usr/bin/docker info','docker'],
  [linux,'sudo systemctl status ssh','sudo-on-demand'],
  [mac,'/opt/homebrew/bin/docker ps','docker'],
  [win,'Set-NetFirewallProfile -Enabled False','windows-defender-firewall']
 ]){
  const userRequired=['filesystem'];
  const effectiveRequest=[...new Set([...userRequired,
   ...a.inferRequiredCapabilities(command)])];
  assert(effectiveRequest.includes(cap));
 }
});
test('Hardware observability coverage is measured, not silently labeled authorized',()=>{
 const linux=adapter('linux'),win=adapter('win32'),mac=adapter('darwin');
 const cases=[
  [linux,['lsusb','udevadm info --help','lspci','ip -br addr',
   'nmcli device status','ethtool --version','lsblk','smartctl -V',
   'modinfo usbcore','dmesg --level err','ufw status','iptables -S',
   'nft list ruleset']],
  [win,['Get-PnpDevice','Get-CimInstance Win32_BIOS',
   'pnputil /enum-devices','Get-Disk','Get-PhysicalDisk','Get-Volume']],
  [mac,['diskutil list','system_profiler SPUSBDataType',
   'ioreg -p IOUSB','networksetup -listallhardwareports','ifconfig -a']]
 ];
 for(const [a,commands] of cases)for(const cmd of commands){
  const actual=a.inferRequiredCapabilities(cmd);
  assert(actual.includes('filesystem'));
  assert(!a.hardDeny?.(cmd),'safe diagnostics unexpectedly hit platform hard deny');
 }
});
