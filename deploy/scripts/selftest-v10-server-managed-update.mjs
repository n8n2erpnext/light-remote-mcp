import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(new URL('../..',import.meta.url).pathname),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const agent=read('device-agent/operator-agent.mjs'),unit=read('deploy/systemd/light-remote-host-wall.service'),page=read('device-agent/update-settings-page.mjs');
if(!unit.includes('LIGHT_REMOTE_UPDATE_MODE=server-managed'))throw new Error('host_wall_update_mode_not_managed');
if(!agent.includes("UPDATE_MODE==='server-managed'")||!agent.includes('update_managed_by_server_deployment'))throw new Error('server_managed_update_boundary_missing');
if(!page.includes('Managed by the server deployment plane')||!page.includes('client Helper does not apply here'))throw new Error('server_managed_update_ui_missing');
if(!agent.includes("requestUpdate:async data=>requestLocalUpdate('local-wall'"))throw new Error('wall_only_update_callback_missing');
console.log('v10-server-managed-update-boundary=PASS');
