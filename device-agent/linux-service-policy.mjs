import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function linuxServicePolicy(state = {}) {
  const approved = new Set(state?.enrollment?.approvedCapabilities || []);
  const denied = new Set(state?.policy?.deniedCapabilities || []);
  const sudoOnDemand = approved.has('sudo-on-demand') && !denied.has('sudo-on-demand');
  return {
    sudoOnDemand,
    noNewPrivileges: !sudoOnDemand,
    restrictSuidSgid: !sudoOnDemand,
    clearCapabilityBoundingSet: !sudoOnDemand
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stateFile = process.argv[2];
  const field = process.argv[3] || 'noNewPrivileges';
  if (!stateFile) throw new Error('state_file_required');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const policy = linuxServicePolicy(state);
  if (!(field in policy)) throw new Error(`unknown_policy_field:${field}`);
  process.stdout.write(String(policy[field]));
}
