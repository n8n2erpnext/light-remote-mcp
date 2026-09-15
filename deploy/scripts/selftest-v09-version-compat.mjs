import {clientCompatibility,minimumSupportedVersion,compareVersion} from '../../lib/version-compat.mjs';

const need=(condition,name)=>{if(!condition)throw new Error(name);};
need(minimumSupportedVersion('0.9.0-rc.24',{backwardReleases:3})==='0.9.0-rc.21','rc24_minimum_not_rc21');
for(const v of ['0.9.0-rc.21','0.9.0-rc.22','0.9.0-rc.23','0.9.0-rc.24']){
  const c=clientCompatibility('0.9.0-rc.24',v,{backwardReleases:3});
  need(c.supported===true&&c.updateRequired===false&&c.status==='supported',`supported_window_failed:${v}`);
}
let c=clientCompatibility('0.9.0-rc.24','0.9.0-rc.20',{backwardReleases:3});
need(c.supported===false&&c.updateRequired===true&&c.status==='client_update_required'&&c.minimumSupportedVersion==='0.9.0-rc.21','too_old_client_not_blocked');
c=clientCompatibility('0.9.0-rc.24','0.9.0-rc.25',{backwardReleases:3});
need(c.supported===false&&c.updateRequired===false&&c.status==='server_update_required','newer_client_not_server_blocked');
c=clientCompatibility('0.9.0-rc.24','0.9-test',{backwardReleases:3});
need(c.supported===false&&c.updateRequired===true&&c.reason==='client_version_invalid','invalid_client_not_blocked');
need(minimumSupportedVersion('0.9.0-rc.24',{backwardReleases:3,explicit:'0.9.0-rc.22'})==='0.9.0-rc.22','explicit_minimum_ignored');
need(compareVersion('0.9.0-rc.24','0.9.0-rc.21')>0&&compareVersion('0.9.0','0.9.0-rc.99')>0,'semver_order_wrong');
console.log('v09-version-compat-rc24-window=PASS');
console.log('v09-version-compat-too-old-force-update=PASS');
console.log('v09-version-compat-newer-server-update=PASS');
