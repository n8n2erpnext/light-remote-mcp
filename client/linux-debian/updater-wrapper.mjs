import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const root=process.env.GPT_OPERATOR_INSTALL_ROOT||'/opt/gpt-operator-agent';
const updater=`${root}/current/client/linux/updater.mjs`;
if(!fs.existsSync(updater))throw new Error('linux_updater_missing');
// Debian 1.0 agent is a user unit. Restart all active user instances after atomic update.
process.env.GPT_OPERATOR_SERVICE='light-remote-agent.service';
const r=spawnSync(`${root}/current/runtime/node`,[updater],{stdio:'inherit',env:{...process.env,LIGHT_REMOTE_SYSTEMD_USER_UNITS:'1'}});
process.exitCode=r.status??1;
