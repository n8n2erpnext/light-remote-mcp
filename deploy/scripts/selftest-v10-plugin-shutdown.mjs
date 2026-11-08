import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const server=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
function need(ok,name){if(!ok)throw new Error(`plugin_shutdown_contract_failed:${name}`);console.log(`${name}=PASS`);}
need(server.includes('server.closeIdleConnections?.()'),'shutdown-idle-connections');
need(server.includes('server.closeAllConnections?.()'),'shutdown-force-close-deadline');
need(server.includes("server.close(()=>{clearTimeout(deadline);process.exit(0);})"),'shutdown-clean-exit');
need(!server.includes('setTimeout(()=>process.exit(1),5000'),'shutdown-no-false-failure');
console.log('PLUGIN_SHUTDOWN_GATE=PASS');
