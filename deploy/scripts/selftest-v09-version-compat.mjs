import fs from 'node:fs';
import {clientCompatibility,minimumSupportedVersion,compareVersion,parseVersion} from '../../lib/version-compat.mjs';

const need=(condition,name)=>{if(!condition)throw new Error(name);};
const current=fs.readFileSync(new URL('../../VERSION',import.meta.url),'utf8').trim(),parsed=parseVersion(current);
need(parsed,'current_version_invalid');
const rc=parsed.pre[0]==='rc'&&/^\d+$/.test(parsed.pre[1]||'')?Number(parsed.pre[1]):null;
need(rc!=null&&rc>3,'current_version_not_supported_by_rc_window_test');
const core=parsed.core.join('.'),minimum=`${core}-rc.${rc-3}`,newer=`${core}-rc.${rc+1}`;
need(minimumSupportedVersion(current,{backwardReleases:3})===minimum,'current_minimum_window_wrong');
for(let n=rc-3;n<=rc;n++){
  const v=`${core}-rc.${n}`,c=clientCompatibility(current,v,{backwardReleases:3});
  need(c.supported===true&&c.updateRequired===false&&c.status==='supported',`supported_window_failed:${v}`);
}
let c=clientCompatibility(current,`${core}-rc.${rc-4}`,{backwardReleases:3});
need(c.supported===false&&c.updateRequired===true&&c.status==='client_update_required'&&c.minimumSupportedVersion===minimum,'too_old_client_not_blocked');
c=clientCompatibility(current,`${core}-rc.6`,{backwardReleases:3});
need(c.supported===false&&c.updateRequired===true&&c.reason==='client_version_too_old'&&c.minimumSupportedVersion===minimum,'legacy_rc6_force_update_failed');
c=clientCompatibility(current,newer,{backwardReleases:3});
need(c.supported===false&&c.updateRequired===false&&c.status==='server_update_required','newer_client_not_server_blocked');
c=clientCompatibility(current,'0.9-test',{backwardReleases:3});
need(c.supported===false&&c.updateRequired===true&&c.reason==='client_version_invalid','invalid_client_not_blocked');
const explicit=`${core}-rc.${rc-2}`;
need(minimumSupportedVersion(current,{backwardReleases:3,explicit})===explicit,'explicit_minimum_ignored');
need(compareVersion(current,minimum)>0&&compareVersion('0.9.0','0.9.0-rc.99')>0,'semver_order_wrong');
console.log(`v09-version-compat-window=PASS current=${current} minimum=${minimum}`);
console.log('v09-version-compat-legacy-rc6-force-update=PASS');
console.log('v09-version-compat-newer-server-update=PASS');
