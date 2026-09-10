import fs from 'node:fs';
import { linuxServicePolicy } from '../../device-agent/linux-service-policy.mjs';

function expect(value,message){if(!value)throw new Error(message);}
const base={enrollment:{approvedCapabilities:['filesystem','git']},policy:{deniedCapabilities:[]}};
const normal=linuxServicePolicy(base);
expect(normal.noNewPrivileges===true,'default_must_keep_no_new_privileges');
expect(normal.sudoOnDemand===false,'default_must_not_allow_privilege_escalation');

const approved=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','sudo-on-demand']},policy:{deniedCapabilities:[]}});
expect(approved.noNewPrivileges===false,'approved_sudo_must_allow_privilege_escalation');
expect(approved.sudoOnDemand===true,'approved_sudo_not_detected');

const denied=linuxServicePolicy({enrollment:{approvedCapabilities:['filesystem','sudo-on-demand']},policy:{deniedCapabilities:['sudo-on-demand']}});
expect(denied.noNewPrivileges===true,'local_deny_must_restore_no_new_privileges');
expect(denied.sudoOnDemand===false,'local_deny_must_win');

const installer=fs.readFileSync(new URL('../../device-agent/install-linux-service.sh',import.meta.url),'utf8');
expect(installer.includes('linux-service-policy.mjs'),'installer_policy_resolver_missing');
expect(installer.includes('NoNewPrivileges=$NO_NEW_PRIVILEGES'),'installer_not_using_resolved_policy');
console.log('v09-linux-service-policy=PASS');
