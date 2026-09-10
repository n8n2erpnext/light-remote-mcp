import { inferCapabilities, uniqueCapabilities } from './shared.mjs';

const RULES=[
  ['git',/(^|[;&|\s])(git)(\s|$)/i],
  ['docker',/(^|[;&|\s])(docker|docker-compose)(\s|$)/i],
  ['lxd',/(^|[;&|\s])(lxc|lxd)(\s|$)/i],
  ['systemctl',/(^|[;&|\s])(systemctl|journalctl)(\s|$)/i],
  ['sudo-on-demand',/(^|[;&|\s])sudo(\s|$)/i],
  ['package-manager',/(^|[;&|\s])(apt|apt-get|dnf|yum|pacman|apk|zypper)(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python3?|pip3?|cargo|rustc|make|cmake)(\s|$)/i]
];

export function createLinuxAdapter({commandExists}) {
  return {
    id:'linux',
    displayName:'Linux shell adapter',
    discoverCapabilities() {
      const caps=['filesystem'];
      if(commandExists('git'))caps.push('git');
      if(['node','python3','cargo'].some(commandExists))caps.push('build-test');
      if(commandExists('docker'))caps.push('docker');
      if(commandExists('lxc'))caps.push('lxd');
      if(commandExists('systemctl'))caps.push('systemctl');
      if(commandExists('sudo'))caps.push('sudo-on-demand');
      if(['apt','apt-get','dnf','yum','pacman','apk','zypper'].some(commandExists))caps.push('package-manager');
      return uniqueCapabilities(caps);
    },
    inferRequiredCapabilities(script) {
      return uniqueCapabilities(['filesystem',...inferCapabilities(script,RULES)]);
    },
    hardDeny() { return null; },
    commandFor(script) {
      return {file:'/bin/bash',args:['-lc',String(script||'')]};
    }
  };
}
