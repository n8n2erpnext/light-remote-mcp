import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadCanonicalEndpoints} from '../../lib/canonical-endpoints.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const target=process.argv[2];
if(!target||!path.isAbsolute(target))throw Error('absolute_output_marker_path_required');
const file=path.join(root,'config/endpoints.json');
const e=loadCanonicalEndpoints(file);
const marker={profile:e.productId,configProfile:e.selectedProfile,
  productId:e.productId,configRevision:e.configRevision,
  configSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  // Legacy marker readers still expect this compatibility property.
  endpoint:e.cloudOrigins.deviceChannel};
fs.mkdirSync(path.dirname(target),{recursive:true});
fs.writeFileSync(target,JSON.stringify(marker)+'\n');
console.log('endpoint_marker_generated profile='+marker.configProfile+
  ' product='+marker.productId+' revision='+marker.configRevision);
