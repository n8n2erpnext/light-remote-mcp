import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function linuxServicePolicy(state = {}) {
  const grantable = new Set(state?.enrollment?.grantableCapabilities || state?.enrollment?.approvedCapabilities || []);
  const sudoGrantable = grantable.has('sudo-on-demand');
  return {
    sudoGrantable,
    noNewPrivileges: !sudoGrantable,
    restrictSuidSgid: !sudoGrantable,
    clearCapabilityBoundingSet: !sudoGrantable
  };
}

if (process.argv[1]) {
  let invoked = false;
  try { invoked = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch {}
  if (invoked) {
  const stateFile = process.argv[2];
  const field = process.argv[3] || 'noNewPrivileges';
  if (!stateFile) throw new Error('state_file_required');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const policy = linuxServicePolicy(state);
  if (!(field in policy)) throw new Error(`unknown_policy_field:${field}`);
  process.stdout.write(String(policy[field]));
  }
}
