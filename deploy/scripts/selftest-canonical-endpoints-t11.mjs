import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateCanonicalEndpoints,loadCanonicalEndpoints,canonicalRoute} from '../../lib/canonical-endpoints.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bytes=fs.readFileSync(path.join(root,'config/endpoints.json'));
const config=JSON.parse(bytes);
const profile=loadCanonicalEndpoints(path.join(root,'config/endpoints.json'));
assert.equal(profile.schemaVersion,1);
assert.equal(profile.productId,'goldabv2-desktop-v4');
assert.equal(profile.selectedProfile,'goldabv2-lab');
assert.equal(canonicalRoute(profile,'ownerToken'),
 profile.cloudOrigins.owner+'/account/desktop/v4/token');
assert.equal(canonicalRoute(profile,'wallStatus'),
 'http://127.0.0.1:'+profile.localServices.wall.port+'/api/status');
assert.equal(profile.updates.manifestUrl,null);
assert.equal(profile.updates.signatureUrl,null);
const clone=()=>JSON.parse(JSON.stringify(config));
const bad=(change,pattern)=>{
 const t=clone();change(t);assert.throws(()=>validateCanonicalEndpoints(t),pattern);
};
bad(t=>t.configRevision=0,/revision/);
bad(t=>t.selectedProfile='regular-gold',/profile_mismatch/);
bad(t=>t.profiles['goldabv2-lab'].productId='legacy-gold',/product_mismatch/);
bad(t=>t.profiles['goldabv2-lab'].cloudOrigins.owner='http://goldabv2.light-remote.thaiduy.digital',/invalid_https_origin/);
bad(t=>t.profiles['goldabv2-lab'].cloudOrigins.owner+='@fake.example',/invalid_https_origin/);
bad(t=>t.profiles['goldabv2-lab'].cloudOrigins.deviceChannel='https://gold.light-remote.thaiduy.digital',/invalid_https_origin|product_mismatch|unexpected_update_feed/);
// Valid HTTPS host is not sufficient for a new authority: credential binding
// must be changed by a reviewed signed package, not an env override.
const issuer=clone();
issuer.profiles['goldabv2-lab'].cloudOrigins.owner='https://example.invalid';
assert.throws(()=>validateCanonicalEndpoints(issuer),/invalid_https_origin/);
bad(t=>t.profiles['goldabv2-lab'].localServices.wall.host='0.0.0.0',/local_loopback_wall/);
bad(t=>t.profiles['goldabv2-lab'].localServices.wall.port=0,/local_loopback_wall/);
bad(t=>t.routeCatalog.wallStatus.path='//example.invalid/steal',/route_path/);
bad(t=>t.routeCatalog.ownerToken.path='/account/../owner',/route_path/);
bad(t=>t.profiles['goldabv2-lab'].updates.manifestUrl='https://example.invalid/release',/unexpected_update_feed/);
// Product/profile configuration cannot be used as a feature flag or grant.
assert.ok(!bytes.includes(Buffer.from('access_token')));
assert.ok(!bytes.includes(Buffer.from('consentCode')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-endpoint-t11-'));
try{
 const outfile=path.join(dir,'marker.json');
 const generator=path.join(root,'deploy/scripts/generate-endpoint-package-marker.mjs');
 const made=spawnSync(process.execPath,[generator,outfile],{encoding:'utf8'});
 assert.equal(made.status,0,made.stderr);
 const marker=JSON.parse(fs.readFileSync(outfile));
 assert.equal(marker.productId,profile.productId);
 assert.equal(marker.configProfile,profile.selectedProfile);
 assert.equal(marker.endpoint,profile.cloudOrigins.deviceChannel);
 assert.equal(marker.configRevision,profile.configRevision);
 assert.match(marker.configSha256,/^[a-f0-9]{64}$/);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('T11_CANONICAL_ENDPOINTS_PROFILE_SCHEMA_ORIGIN_LOOPBACK_ROUTES_HOLD_MARKER_PASS');
