import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const publicRoutes=read('plugin-server/device-public.mjs');
const gateway=read('gateway/server.mjs');
const backend=read('operator-host/executor-routes-device-channel.mjs');
const agent=read('device-agent/operator-agent.mjs');
function assert(ok,message){if(!ok)throw new Error(message);}
assert(/const CHANNEL\s*=\s*new Set\(\[([\s\S]*?)\]\)/.test(publicRoutes),'direct_channel_allowlist_missing');
const allowlist=publicRoutes.match(/const CHANNEL\s*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1]||'';
assert(/['"]renew['"]/.test(allowlist),'direct_renew_not_allowed');
assert(!/['"]made-up-action['"]/.test(allowlist),'direct_allowlist_unexpected_bypass');
assert(gateway.includes("app.post('/device-channel/renew', deviceChannelEdgeRateLimit"),'legacy_gateway_renew_route_missing');
assert(gateway.includes("'/v1/device-channel/renew'"),'legacy_gateway_renew_target_missing');
assert(backend.includes("url.pathname === '/v1/device-channel/renew'"),'operator_backend_renew_missing');
assert(agent.includes("channelRequest(state,hub,'renew'"),'agent_renew_call_missing');
console.log('device_channel_renew_all_layers_contract=PASS');
