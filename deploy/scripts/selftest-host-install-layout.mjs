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
  ['lib/device-proof.mjs', 'device-proof.mjs']
];
for (const [src, dest] of files) fs.copyFileSync(path.join(root, src), path.join(dir, dest));
await import(pathToFileURL(path.join(dir, 'enrollment-registry.mjs')));
const installer = fs.readFileSync(path.join(root, 'deploy/scripts/install-host.sh'), 'utf8');
for (const [, dest] of files) if (!installer.includes(`/opt/gpt-vps-operator/${dest}`)) throw new Error(`installer_missing_${dest}`);
console.log('host-install-layout-imports=PASS');
console.log('host-install-layout-manifest=PASS');
