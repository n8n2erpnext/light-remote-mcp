import fs from 'node:fs';
import {clientCompatibility,releaseCompatibilityFloor,compareVersion,parseVersion} from '../../lib/version-compat.mjs';

const need=(condition,name)=>{if(!condition)throw new Error(name);};
const current=fs.readFileSync(new URL('../../VERSION',import.meta.url),'utf8').trim(),parsed=parseVersion(current),floor=releaseCompatibilityFloor();
need(parsed,'current_version_invalid');
need(floor==='0.9.0-rc.26','release_compatibility_floor_wrong');
need(compareVersion(current,floor)>0,'release_floor_not_older_than_current');

let c=clientCompatibility(current,'0.9.0-rc.26',{explicit:floor});
need(c.supported===true&&c.updateRequired===false&&c.status==='supported','rc26_transition_client_not_supported');
c=clientCompatibility(current,'0.9.0-rc.25',{explicit:floor});
need(c.supported===false&&c.updateRequired===true&&c.status==='client_update_required'&&c.minimumSupportedVersion===floor,'pre_floor_client_not_blocked');
c=clientCompatibility(current,current,{explicit:floor});
need(c.supported===true&&c.updateRequired===false,'current_client_not_supported');
c=clientCompatibility(current,'0.9.1-beta.3',{explicit:floor});
need(c.supported===false&&c.updateRequired===false&&c.status==='server_update_required','newer_client_not_server_blocked');
c=clientCompatibility(current,'0.9-test',{explicit:floor});
need(c.supported===false&&c.updateRequired===true&&c.reason==='client_version_invalid','invalid_client_not_blocked');
need(compareVersion('0.9.1-beta.1','0.9.0-rc.99')>0&&compareVersion('0.9.0','0.9.0-rc.99')>0,'semver_order_wrong');

console.log(`v09-version-compat-transition=PASS current=${current} floor=${floor}`);
console.log('v09-version-compat-rc26-supported=PASS');
console.log('v09-version-compat-pre-floor-blocked=PASS');
console.log('v09-version-compat-newer-server-update=PASS');
