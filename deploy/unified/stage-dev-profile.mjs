import fs from 'node:fs';
import crypto from 'node:crypto';
import {validateCanonicalEndpoints} from '../../lib/canonical-endpoints.mjs';
const file='config/endpoints.json';
const config=JSON.parse(fs.readFileSync(file,'utf8'));
const selection=process.argv[2]||'0';
if(!['0','1'].includes(selection))throw Error('invalid_disposable_fixture_profile_selection');
if(selection==='1'){
 config.selectedProfile='goldabv2-production';
 fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
}
const endpoints=validateCanonicalEndpoints(config);
fs.writeFileSync('device-agent/goldabv2-package-profile.json',JSON.stringify({
 profile:endpoints.productId,productId:endpoints.productId,
 configProfile:endpoints.selectedProfile,configRevision:endpoints.configRevision,
 configSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
 endpoint:endpoints.cloudOrigins.deviceChannel,
 buildProfile:'goldabv2-desktop-v4',purpose:'disposable-unified-dev-image'
},null,2)+'\n');
