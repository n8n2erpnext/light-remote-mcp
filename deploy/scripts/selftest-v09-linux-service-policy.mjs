import fs from 'node:fs';
import { linuxServicePolicy } from '../../device-agent/linux-service-policy.mjs';
function expect(value,message){if(!value)throw new Error(message);}
const normal=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','git']},policy:{deniedCapabilities:[]}});
expect(normal.sudoOnDemand===false,'default_sudo_state');
expect(normal.noNewPrivileges===true,'default_nnp');
expect(normal.restrictSuidSgid===true,'default_suid_guard');
expect(normal.clearCapabilityBoundingSet===true,'default_capability_bound');
const approved=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','sudo-on-demand']},policy:{deniedCapabilities:[]}});
expect(approved.sudoOnDemand===true,'approved_sudo_state');
expect(approved.noNewPrivileges===false,'approved_nnp');
expect(approved.restrictSuidSgid===false,'approved_suid_guard');
expect(approved.clearCapabilityBoundingSet===false,'approved_capability_bound');
const denied=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','sudo-on-demand']},policy:{deniedCapabilities:['sudo-on-demand']}});
expect(denied.sudoOnDemand===false,'deny_must_win');
expect(denied.noNewPrivileges===true&&denied.restrictSuidSgid===true&&denied.clearCapabilityBoundingSet===true,'deny_must_restore_hardening');
const installer=fs.readFileSync(new URL('../../device-agent/install-linux-service.sh',import.meta.url),'utf8');
for(const marker of ['linux-service-policy.mjs','NoNewPrivileges=$NO_NEW_PRIVILEGES','RestrictSUIDSGID=$RESTRICT_SUID_SGID','$CAPABILITY_BOUNDING_SET_LINE','AmbientCapabilities='])expect(installer.includes(marker),`installer_policy_marker_missing:${marker}`);
console.log('v09-linux-service-policy=PASS');
