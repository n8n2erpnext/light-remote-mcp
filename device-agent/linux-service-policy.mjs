import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in installer-level mount exceptions. This is NOT a general host-admin
// broker: it only permits sudo-approved jobs to modify these owner-selected
// directories, while ProtectSystem=strict remains active elsewhere.
const HOST_WRITE_ROOTS=['/etc/','/usr/local/','/var/lib/','/opt/'];
const HOST_WRITE_FORBIDDEN=new Set(['/','/etc','/etc/systemd','/usr','/usr/local','/var','/var/lib','/opt','/home','/root','/run','/tmp','/boot','/proc','/sys','/dev']);
export function validateLinuxHostWritePaths(paths=[],{filesystem=fs}={}){
  if(!Array.isArray(paths)||paths.length>4)throw new Error('host_write_paths_limit_exceeded');
  const result=[];
  for(const input of paths){
    const value=String(input||'');
    if(value.length>256||!/^\/[A-Za-z0-9._/-]+$/.test(value)||value.includes('..')||value.includes('//')||value.endsWith('/'))throw new Error('host_write_path_invalid');
    if(path.posix.normalize(value)!==value||HOST_WRITE_FORBIDDEN.has(value)||!HOST_WRITE_ROOTS.some(prefix=>value.startsWith(prefix)))throw new Error('host_write_path_too_broad');
    if(filesystem.realpathSync(value)!==value)throw new Error('host_write_path_symlink');
    const stat=filesystem.lstatSync(value);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw new Error('host_write_path_not_root_owned_directory');
    // Every ancestor must be root-controlled. This blocks writable parents
    // from replacing the selected directory with a new symlink after install.
    let parent=path.posix.dirname(value);
    while(parent!=='/'){
      const st=filesystem.lstatSync(parent);
      if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)throw new Error('host_write_path_untrusted_parent');
      parent=path.posix.dirname(parent);
    }
    if(!result.includes(value))result.push(value);
  }
  return result;
}

export function linuxServicePolicy(state = {}) {
  // OS-supported capabilities must not relax systemd's sandbox by themselves.
  // Leaf requires explicit server approval; trusted Main requires local ON.
  const enrollment=state?.enrollment||{};
  const serverApproved=new Set(enrollment.approvedCapabilities||[]);
  const main=enrollment.enrollmentId==='trusted-host';
  const mainGrantable=new Set(enrollment.grantableCapabilities||enrollment.approvedCapabilities||[]);
  const localDenied=new Set(state?.policy?.deniedCapabilities||[]);
  const sudoGrantable=main ? (mainGrantable.has('sudo-on-demand')&&!localDenied.has('sudo-on-demand')) : serverApproved.has('sudo-on-demand');
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
  if(field==='hostWritePaths'){process.stdout.write(validateLinuxHostWritePaths(process.argv.slice(4)).join(' '));process.exit(0);}
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const policy = linuxServicePolicy(state);
  if (!(field in policy)) throw new Error(`unknown_policy_field:${field}`);
  process.stdout.write(String(policy[field]));
  }
}
