import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareVersion, newer, parseVersion } from '../../client/linux/updater.mjs';
function expect(value,message){if(!value)throw new Error(message);}
const source=fs.readFileSync(new URL('../../client/linux/updater.mjs',import.meta.url),'utf8');
expect(newer('0.9.0','0.9.0-dev'),'dev_to_stable_not_newer');
expect(newer('0.9.1','0.9.0-dev'),'dev_to_next_patch_not_newer');
expect(!newer('0.9.0-dev','0.9.0'),'prerelease_must_not_beat_stable');
expect(newer('0.9.0-rc.2','0.9.0-rc.1'),'rc_numeric_order_failed');
expect(newer('0.9.0-rc.1','0.9.0-beta.9'),'prerelease_lexical_order_failed');
expect(compareVersion('0.9.0+build.2','0.9.0+build.1')===0,'build_metadata_changed_precedence');
expect(parseVersion('0.09.0')===null&&parseVersion('garbage')===null,'invalid_semver_accepted');
expect(source.includes("['--no-same-owner','-xzf'"),'updater_tar_owner_preservation_not_disabled');
expect(source.includes("run('chown',['-R','root:root',target])"),'updater_root_ownership_hardening_missing');
expect(source.includes("run('chmod',['-R','go-w',target])"),'updater_write_hardening_missing');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lrm-updater-main-'));
try{
  const sourcePath=fileURLToPath(new URL('../../client/linux/updater.mjs',import.meta.url));
  const link=path.join(tmp,'updater-link.mjs');fs.symlinkSync(sourcePath,link);
  const result=spawnSync(process.execPath,[link],{encoding:'utf8',env:{...process.env,GPT_OPERATOR_INSTALL_ROOT:path.join(tmp,'install'),GPT_OPERATOR_UPDATE_MANIFEST_URL:'http://127.0.0.1:9/manifest',GPT_OPERATOR_UPDATE_SIGNATURE_URL:'http://127.0.0.1:9/signature'}});
  expect(result.status!==0&&String(result.stderr).includes('update_failed:'),'updater_symlink_entrypoint_not_executed');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log('linux-updater-semver=PASS');
