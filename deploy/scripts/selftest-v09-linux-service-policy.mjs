import fs from 'node:fs';
import { linuxServicePolicy } from '../../device-agent/linux-service-policy.mjs';
function expect(value,message){if(!value)throw new Error(message);}
const normal=linuxServicePolicy({enrollment:{grantableCapabilities:['filesystem','git'],approvedCapabilities:['filesystem','git']}});
expect(normal.sudoGrantable===false,'default_sudo_grantable_state');
expect(normal.noNewPrivileges===true&&normal.restrictSuidSgid===true&&normal.clearCapabilityBoundingSet===true,'default_hardening');
const enabled=linuxServicePolicy({enrollment:{grantableCapabilities:['filesystem','sudo-on-demand'],approvedCapabilities:['filesystem','sudo-on-demand']}});
expect(enabled.sudoGrantable===true,'grantable_sudo_missing');
expect(enabled.noNewPrivileges===false&&enabled.restrictSuidSgid===false&&enabled.clearCapabilityBoundingSet===false,'grantable_sudo_hardening_not_relaxed');
const webDisabled=linuxServicePolicy({enrollment:{grantableCapabilities:['filesystem','sudo-on-demand'],approvedCapabilities:['filesystem']},policy:{deniedCapabilities:[]}});
expect(webDisabled.sudoGrantable===true,'web_disable_must_not_remove_future_grantability');
expect(webDisabled.noNewPrivileges===false&&webDisabled.restrictSuidSgid===false&&webDisabled.clearCapabilityBoundingSet===false,'web_toggle_must_not_require_service_reinstall');
const legacy=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','sudo-on-demand']}});
expect(legacy.sudoGrantable===true,'legacy_approved_sudo_fallback_missing');
const installer=fs.readFileSync(new URL('../../device-agent/install-linux-service.sh',import.meta.url),'utf8');
for(const marker of ['linux-service-policy.mjs','NoNewPrivileges=$NO_NEW_PRIVILEGES','RestrictSUIDSGID=$RESTRICT_SUID_SGID','$CAPABILITY_BOUNDING_SET_LINE','AmbientCapabilities='])expect(installer.includes(marker),`installer_policy_marker_missing:${marker}`);
console.log('v09-linux-service-policy=PASS');
console.log('v09-linux-web-sudo-toggle-no-reinstall=PASS');
