import fs from 'node:fs';
import crypto from 'node:crypto';
import {loadCanonicalEndpoints} from '../../lib/canonical-endpoints.mjs';
const file='config/endpoints.json';
const endpoints=loadCanonicalEndpoints(file);
fs.writeFileSync('device-agent/goldabv2-package-profile.json',JSON.stringify({
 profile:endpoints.productId,productId:endpoints.productId,
 configProfile:endpoints.selectedProfile,configRevision:endpoints.configRevision,
 configSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
 endpoint:endpoints.cloudOrigins.deviceChannel,
 buildProfile:'goldabv2-desktop-v4',purpose:'disposable-unified-dev-image'
},null,2)+'\n');
