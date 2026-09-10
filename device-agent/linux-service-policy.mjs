import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function linuxServicePolicy(state = {}) {
  const approved = new Set(state?.enrollment?.approvedCapabilities || []);
  const denied = new Set(state?.policy?.deniedCapabilities || []);
  const sudoOnDemand = approved.has('sudo-on-demand') && !denied.has('sudo-on-demand');
  return {
    sudoOnDemand,
    noNewPrivileges: !sudoOnDemand
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stateFile = process.argv[2];
  if (!stateFile) throw new Error('state_file_required');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  process.stdout.write(linuxServicePolicy(state).noNewPrivileges ? 'true' : 'false');
}
