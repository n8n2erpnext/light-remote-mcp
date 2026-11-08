import { inferCapabilities, uniqueCapabilities } from './shared.mjs';

function scopedInstaller(script){
  const m=/^[ \t]*(?:sudo[ \t]+(?:-n[ \t]+)?)?(?:\/opt\/homebrew\/bin\/|\/usr\/local\/bin\/)?brew[ \t]+install[ \t]+(?:(?:--cask|--formula)[ \t]+)?(docker|podman|kubectl|helm|colima)(?:[ \t]+--cask)?[ \t]*$/i.exec(String(script||''));
  if(!m)return null;
  const pkg=m[1].toLowerCase();
  return pkg==='kubectl'||pkg==='helm'?'kubernetes':pkg==='colima'?'virtualization':pkg;
}
const RULES=[
  ['git',/(^|[;&|\s])git(\s|$)/i],
  ['docker',/(^|[;&|\s"'`])(?:\/opt\/homebrew\/bin\/|\/(?:usr\/)?(?:local\/)?s?bin\/)?(docker|docker-compose)(?=\s|$|["'`;|&])/i],
  ['package-manager',/(^|[;&|\s])(brew|port)(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python3?|pip3?|cargo|rustc|make|cmake|xcodebuild|swift)(\s|$)/i],
  ['sudo-on-demand',/(^|[;&|\s])sudo(\s|$)/i],
  ['macos-services',/(^|[;&|\s])launchctl(\s|$)/i],
  ['macos-log',/(^|[;&|\s])log\s+(show|stream|collect)(\s|$)/i],
  ['kubernetes',/(^|[;&|\s"'`])(kubectl|helm|kind|minikube)(?=\s|$|["'`;|&])/i],
  ['virtualization',/(^|[;&|\s"'`])(colima|limactl|multipass|vz)(?=\s|$|["'`;|&])/i],
  ['network-admin',/(^|[;&|\s"'`])(networksetup|ifconfig|route|scutil|wg|wg-quick)(?=\s|$|["'`;|&])/i],
  ['firewall',/(^|[;&|\s"'`])(pfctl|socketfilterfw)(?=\s|$|["'`;|&])/i],
  ['infra-provisioning',/(^|[;&|\s"'`])(terraform|tofu|ansible|ansible-playbook|packer|pulumi|vagrant)(?=\s|$|["'`;|&])/i],
  ['storage-admin',/(^|[;&|\s"'`])(diskutil|hdiutil)(?=\s|$|["'`;|&])/i]
];

export function createMacOSAdapter({commandExists}) {
  return {
    id:'darwin',displayName:'macOS shell adapter',
    discoverCapabilities(){return uniqueCapabilities(['filesystem','git','build-test','terminal','docker','package-manager','sudo-on-demand','macos-services','macos-log','kubernetes','virtualization','network-admin','firewall','storage-admin','infra-provisioning']);},
    installedCapabilities(){const caps=['filesystem'];const test=(cap,names)=>{if(names.some(commandExists))caps.push(cap);};test('git',['git']);test('build-test',['node','python3','cargo','swift']);test('terminal',['zsh','bash','sh']);test('docker',['docker']);test('package-manager',['brew','port']);test('sudo-on-demand',['sudo']);test('macos-services',['launchctl']);test('macos-log',['log']);test('kubernetes',['kubectl','helm']);test('virtualization',['colima','limactl','multipass']);test('network-admin',['networksetup','ifconfig']);test('firewall',['pfctl']);test('storage-admin',['diskutil']);test('infra-provisioning',['terraform','tofu','ansible','pulumi']);return uniqueCapabilities(caps);},
    inferRequiredCapabilities(script){return uniqueCapabilities(['filesystem',...inferCapabilities(scopedInstaller(script)||script,RULES)]);},
    hardDeny(script){const text=String(script||'');if(/security\s+(dump-keychain|find-generic-password|find-internet-password)[^\n]*(?:-w|password)/i.test(text))return 'macos_keychain_secret_export_denied';return null;},
    shellModes(){const modes=['default'];for(const name of ['zsh','bash','sh'])if(commandExists(name))modes.push(name);return [...new Set(modes)];},
    commandFor(script,{shell='default'}={}){const requested=String(shell||'default').trim().toLowerCase(),selected=requested==='default'?(commandExists('zsh')?'zsh':commandExists('bash')?'bash':commandExists('sh')?'sh':null):requested,files={zsh:'/bin/zsh',bash:'/bin/bash',sh:'/bin/sh'};if(!selected||!files[selected]||!commandExists(selected))throw new Error(`macos_shell_unavailable:${requested}`);return {file:files[selected],args:['-lc',String(script||'')]};},
    terminalFor({shell='default'}={}){const requested=String(shell||'default').trim().toLowerCase(),selected=requested==='default'?(commandExists('zsh')?'zsh':commandExists('bash')?'bash':commandExists('sh')?'sh':null):requested,files={zsh:'/bin/zsh',bash:'/bin/bash',sh:'/bin/sh'};if(!selected||!files[selected]||!commandExists(selected))throw new Error(`macos_shell_unavailable:${requested}`);return {file:files[selected],args:selected==='sh'?[]:['-l'],shell:selected};}
  };
}
