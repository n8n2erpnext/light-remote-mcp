#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const server=read('gateway/server.mjs'),api=read('api/operator.js');
const docker=read('gateway/Dockerfile'),sync=read('deploy/scripts/sync-gateway.sh');
for(const f of ['chunk-transfer.mjs','plus-transfer.mjs']){
  assert(docker.includes(f),`gateway docker missing ${f}`);
  assert(sync.includes(f),`gateway sync missing ${f}`);
}
for(const route of ['/plus/client/transfers','/plus/client/transfers/:id/chunk','/plus/client/transfers/:id/status','/plus/client/transfers/:id/commit','/plus/client/transfers/:id/cancel']) assert(server.includes(route),`gateway route missing ${route}`);
assert.match(server,/transfers'.*requirePlusVercelIdentity.*plusAuth\.requireClient.*plusAuth\.requireClientDevice.*plusTransfer\.begin/s);
assert.match(server,/transfers\/:id\/commit'.*requirePlusVercelIdentity.*plusAuth\.requireClient.*plusAuth\.requireClientDevice.*plusTransfer\.commit/s);
console.log('v10-gateway-transfer-packaging-auth-surface=PASS');assert(api.includes("action.startsWith('transfer-')"),'Vercel transfer action family missing');
for(const op of ['begin','chunk','status','commit','cancel']) assert(api.includes(`'${op}'`),`Vercel transfer op missing ${op}`);
assert(api.includes("purpose:'operator-payload'"),'Vercel transfer purpose not fixed');
assert(api.includes("clientCall('/plus/client/transfers'"),'Vercel transfer begin is not client-scoped');
assert(api.includes("/plus/client/transfers/${encodeURIComponent(transferId)}/"),'Vercel transfer continuation is not client-scoped');
assert(!server.includes("../lib/chunk-transfer.mjs"),'Gateway container must not depend on parent lib path');
console.log('v10-vercel-transfer-client-surface=PASS');
