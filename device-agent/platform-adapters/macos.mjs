import { inferCapabilities, uniqueCapabilities } from './shared.mjs';

const RULES=[
  ['git',/(^|[;&|\s])git(\s|$)/i],
  ['docker',/(^|[;&|\s])docker(\s|$)/i],
  ['package-manager',/(^|[;&|\s])(brew|port)(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python3?|pip3?|cargo|rustc|make|cmake|xcodebuild|swift)(\s|$)/i],
  ['sudo-on-demand',/(^|[;&|\s])sudo(\s|$)/i],
  ['macos-services',/(^|[;&|\s])launchctl(\s|$)/i],
  ['macos-log',/(^|[;&|\s])log\s+(show|stream|collect)(\s|$)/i]
];

export function createMacOSAdapter({commandExists}) {
  return {
    id:'darwin',displayName:'macOS shell adapter',
    discoverCapabilities(){const caps=['filesystem'];if(commandExists('git'))caps.push('git');if(['node','python3','cargo','swift','xcodebuild'].some(commandExists))caps.push('build-test');if(commandExists('docker'))caps.push('docker');if(commandExists('brew')||commandExists('port'))caps.push('package-manager');if(commandExists('sudo'))caps.push('sudo-on-demand');if(commandExists('launchctl'))caps.push('macos-services');if(commandExists('log'))caps.push('macos-log');return uniqueCapabilities(caps);},
    inferRequiredCapabilities(script){return uniqueCapabilities(['filesystem',...inferCapabilities(script,RULES)]);},
    hardDeny(script){const text=String(script||'');if(/security\s+(dump-keychain|find-generic-password|find-internet-password)[^\n]*(?:-w|password)/i.test(text))return 'macos_keychain_secret_export_denied';return null;},
    commandFor(script){return {file:'/bin/zsh',args:['-lc',String(script||'')]};}
  };
}
