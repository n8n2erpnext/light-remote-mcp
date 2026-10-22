import { inferCapabilities, uniqueCapabilities } from './shared.mjs';

// A service *name* is not an executable. Limit this exception to an entire,
// literal, read-only systemctl status query with no shell metacharacters,
// expansion, quoting, extra arguments or command chaining. All other scripts
// retain the existing conservative capability inference.
// This affects ONLY capability classification; original script is untouched.
function classificationInput(script) {
  const input=String(script||'');
  // A *single*, literal installation of one named infrastructure runtime is
  // governed by that runtime's owner toggle, even before it exists on disk.
  // This grants no arbitrary package or sudo command. Shell operators, variable
  // expansion, extra packages and alternate installer flags fall through to
  // the separately controlled package-manager/sudo capabilities.
  const install=/^[ \t]*(?:(?:\/usr\/bin\/)?sudo[ \t]+(?:-n[ \t]+)?)?(?:\/usr\/bin\/)?(?:apt|apt-get|snap)[ \t]+install[ \t]+(?:(?:-y|--yes|--classic)[ \t]+)?(lxd|incus|podman|docker|docker\.io|docker-ce)(?:[ \t]+--classic)?[ \t]*$/i.exec(input);
  if(install){
    const name=install[1].toLowerCase();
    return name.startsWith('docker')?'docker':name;
  }
  // Exact read-only shell probes are not Docker operations. Chaining,
  // substitution, quoting or arguments beyond the command name fall through.
  if(/^[ \t]*(?:command[ \t]+-v|type[ \t]+-P|which)[ \t]+(?:docker|docker-compose|lxd|lxc|podman|incus|kubectl|helm|virsh|nft|iptables|ip6tables|snap|apt|apt-get)[ \t]*$/i.test(input))return 'lr_readonly_executable_probe';
  // A literal journalctl unit selector is diagnostic data, not the Docker
  // executable. Permit only one complete read-only invocation and the
  // whitelisted output/length flags. No quoting, expansions or shell chaining.
  const journal=/^[ \t]*(?:(?:\/usr\/bin\/)?sudo[ \t]+-n[ \t]+)?(?:\/usr\/bin\/)?journalctl[ \t]+(?:(?:--no-pager|-n[ \t]+(?:0|[1-9][0-9]{0,5}))[ \t]+)?(?:(?:-u|--unit)[ \t]+|--unit=)(docker(?:\.service)?)(?:[ \t]+(?:--no-pager|-n[ \t]+(?:0|[1-9][0-9]{0,5})))?[ \t]*$/i.exec(input);
  if(journal){
    const unit=journal[1],i=input.lastIndexOf(unit);
    return input.slice(0,i)+'lr_service_unit'+input.slice(i+unit.length);
  }
  // SP/TAB only: a newline separates shell commands and must not qualify
  // for the single-command service-status exception.
  const match=/^[ \t]*(?:(?:\/usr\/bin\/)?sudo[ \t]+-n[ \t]+)?(?:\/usr\/bin\/)?systemctl[ \t]+(?:is-active|is-enabled|status)[ \t]+(docker|docker\.service)[ \t]*$/i.exec(input);
  if(!match)return input;
  const token=match[1];
  const i=match.index+match[0].lastIndexOf(token);
  return input.slice(0,i)+'lr_service_unit'+input.slice(i+token.length);
}

const RULES=[
  ['git',/(^|[;&|\s])(git)(\s|$)/i],
  // Recognize standard absolute executable paths as the same authority as
  // bare commands. A path prefix must never hide Docker from local policy.
  // Parentheses allow detecting Docker as the command in $(docker ...) or
  // $(/usr/bin/docker ...), not just plain top-level shell statements.
  ['docker',/(^|[();&|\s"'`])(?:\/(?:usr\/)?(?:local\/)?s?bin\/)?(docker|docker-compose)(?=\s|$|[)"'`;|&])/i],
  ['lxd',/(^|[;&|\s"'`])(?:\/(?:usr\/)?(?:local\/)?s?bin\/)?(lxc|lxd)(?=\s|$|["'`;|&])/i],
  ['systemctl',/(^|[;&|\s])(systemctl|journalctl)(\s|$)/i],
  ['sudo-on-demand',/(^|[;&|\s])sudo(\s|$)/i],
  ['package-manager',/(^|[;&|\s])(apt|apt-get|apt-cache|dnf|yum|pacman|apk|zypper|snap|flatpak|rpm|dpkg|dpkg-query)(\s|$)/i],
  ['build-test',/(^|[;&|\s])(node|npm|npx|pnpm|yarn|python3?|pip3?|cargo|rustc|make|cmake)(\s|$)/i],
  ['podman',/(^|[();&|\s"'`])(podman|buildah|skopeo)(?=\s|$|[)"'`;|&])/i],
  ['incus',/(^|[();&|\s"'`])incus(?=\s|$|[)"'`;|&])/i],
  ['kubernetes',/(^|[();&|\s"'`])(kubectl|helm|k3s|kubeadm|microk8s|kind)(?=\s|$|[)"'`;|&])/i],
  ['virtualization',/(^|[();&|\s"'`])(virsh|virt-install|qemu-system-[\w-]+|qm|pct|pvesh)(?=\s|$|[)"'`;|&])/i],
  ['network-admin',/(^|[();&|\s"'`])(ip|nmcli|netplan|wg|wg-quick|ethtool|bridge|tc)(?=\s|$|[)"'`;|&])/i],
  ['firewall',/(^|[();&|\s"'`])(nft|iptables|ip6tables|ufw|firewall-cmd|ipset|bpftool)(?=\s|$|[)"'`;|&])/i],
  ['infra-provisioning',/(^|[();&|\s"'`])(terraform|tofu|ansible|ansible-playbook|packer|pulumi|vagrant|nomad|consul)(?=\s|$|[)"'`;|&])/i],
  ['storage-admin',/(^|[();&|\s"'`])(lsblk|mount|umount|fdisk|sfdisk|parted|lvcreate|vgcreate|pvcreate|zpool|zfs|mdadm|cryptsetup|mkfs(?:\.[\w-]+)?)(?=\s|$|[)"'`;|&])/i]
];

export function createLinuxAdapter({commandExists}) {
  return {
    id:'linux',
    displayName:'Linux shell adapter',
    // Owner rights are OS capabilities; binary installation is separate telemetry.
    discoverCapabilities(){return uniqueCapabilities(['filesystem','git','build-test','terminal','docker','lxd','podman','incus','kubernetes','virtualization','network-admin','firewall','storage-admin','infra-provisioning','systemctl','sudo-on-demand','package-manager']);},
    installedCapabilities() {
      const caps=['filesystem'];
      const test=(cap,names)=>{if(names.some(commandExists))caps.push(cap);};
      test('git',['git']);test('build-test',['node','python3','cargo']);test('terminal',['bash','zsh','sh']);
      test('docker',['docker']);test('lxd',['lxc','lxd']);test('podman',['podman']);test('incus',['incus']);
      test('kubernetes',['kubectl','helm','k3s','microk8s']);test('virtualization',['virsh','qm','qemu-system-x86_64']);
      test('network-admin',['ip','nmcli','netplan']);test('firewall',['nft','iptables','ufw','firewall-cmd']);
      test('storage-admin',['lsblk','mount','zpool']);test('infra-provisioning',['terraform','tofu','ansible','pulumi']);test('systemctl',['systemctl']);
      test('sudo-on-demand',['sudo']);test('package-manager',['apt','apt-get','dnf','yum','snap','pacman','apk','zypper']);
      return uniqueCapabilities(caps);
    },
    inferRequiredCapabilities(script) {
      return uniqueCapabilities(['filesystem',...inferCapabilities(classificationInput(script),RULES)]);
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
