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
      if(['bash','zsh','sh'].some(commandExists))caps.push('terminal');
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
    shellModes() {
      const modes=['default'];
      for(const name of ['bash','zsh','sh'])if(commandExists(name))modes.push(name);
      return [...new Set(modes)];
    },
    commandFor(script,{shell='default'}={}) {
      const requested=String(shell||'default').trim().toLowerCase();
      const selected=requested==='default'?(commandExists('bash')?'bash':commandExists('sh')?'sh':null):requested;
      const files={bash:'/bin/bash',zsh:'/bin/zsh',sh:'/bin/sh'};
      if(!selected||!files[selected]||!commandExists(selected))throw new Error(`linux_shell_unavailable:${requested}`);
      return {file:files[selected],args:['-lc',String(script||'')]};
        },
    terminalFor({shell='default'}={}) {
      const requested=String(shell||'default').trim().toLowerCase();
      const selected=requested==='default'?(commandExists('bash')?'bash':commandExists('sh')?'sh':null):requested;
      const files={bash:'/bin/bash',zsh:'/bin/zsh',sh:'/bin/sh'};
      if(!selected||!files[selected]||!commandExists(selected))throw new Error(`linux_shell_unavailable:${requested}`);
      return {file:files[selected],args:selected==='sh'?[]:['-l'],shell:selected};
    }
  };
}
