import fs from 'node:fs';
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
console.log('linux-updater-semver=PASS');
