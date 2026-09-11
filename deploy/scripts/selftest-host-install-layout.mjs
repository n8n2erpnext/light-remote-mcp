import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-host-layout-'));
const files = [
  ['operator-host/executor.mjs', 'executor.mjs'],
  ['operator-host/crypto.mjs', 'crypto.mjs'],
  ['operator-host/session-manager.mjs', 'session-manager.mjs'],
  ['operator-host/device-registry.mjs', 'device-registry.mjs'],
  ['operator-host/enrollment-registry.mjs', 'enrollment-registry.mjs'],
  ['operator-host/fleet-router.mjs', 'fleet-router.mjs'],
  ['operator-host/device-connection-registry.mjs', 'device-connection-registry.mjs'],
  ['operator-host/device-access-grant-registry.mjs', 'device-access-grant-registry.mjs'],
  ['operator-host/device-pairing-registry.mjs', 'device-pairing-registry.mjs'],
  ['operator-host/agent-client-registry.mjs', 'agent-client-registry.mjs'],
  ['lib/device-proof.mjs', 'device-proof.mjs']
];
for (const [src, dest] of files) fs.copyFileSync(path.join(root, src), path.join(dir, dest));
await import(pathToFileURL(path.join(dir, 'enrollment-registry.mjs')));
await import(pathToFileURL(path.join(dir, 'fleet-router.mjs')));
await import(pathToFileURL(path.join(dir, 'device-connection-registry.mjs')));
await import(pathToFileURL(path.join(dir, 'device-access-grant-registry.mjs')));
await import(pathToFileURL(path.join(dir, 'device-pairing-registry.mjs')));
await import(pathToFileURL(path.join(dir, 'agent-client-registry.mjs')));
const installer = fs.readFileSync(path.join(root, 'deploy/scripts/install-host.sh'), 'utf8');
for (const [, dest] of files) if (!installer.includes(`/opt/gpt-vps-operator/${dest}`)) throw new Error(`installer_missing_${dest}`);
console.log('host-install-layout-imports=PASS');
console.log('host-install-layout-manifest=PASS');
