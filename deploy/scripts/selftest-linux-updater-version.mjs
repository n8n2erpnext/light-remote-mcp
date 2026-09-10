import { compareVersion, newer, parseVersion } from '../../client/linux/updater.mjs';
function expect(value,message){if(!value)throw new Error(message);}
expect(newer('0.9.0','0.9.0-dev'),'dev_to_stable_not_newer');
expect(newer('0.9.1','0.9.0-dev'),'dev_to_next_patch_not_newer');
expect(!newer('0.9.0-dev','0.9.0'),'prerelease_must_not_beat_stable');
expect(newer('0.9.0-rc.2','0.9.0-rc.1'),'rc_numeric_order_failed');
expect(newer('0.9.0-rc.1','0.9.0-beta.9'),'prerelease_lexical_order_failed');
expect(compareVersion('0.9.0+build.2','0.9.0+build.1')===0,'build_metadata_changed_precedence');
expect(parseVersion('0.09.0')===null&&parseVersion('garbage')===null,'invalid_semver_accepted');
console.log('linux-updater-semver=PASS');
