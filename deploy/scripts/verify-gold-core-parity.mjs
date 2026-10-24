/**
 * Immutable Gold #486 Client Core parity guard.
 * Checks package BYTES vs frozen Git, not vs the candidate's own manifest.
 * No writes; no live-owner-acceptance claim.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const FROZEN='30766940ac18e55cb735354b40a3af9ba37eddb8';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const target=process.argv[2] && path.resolve(process.argv[2]);
const mode=process.argv[3]||'exact';
if(!target||!fs.existsSync(target)||!['exact','extension'].includes(mode))
 throw Error('usage: node deploy/scripts/verify-gold-core-parity.mjs <package-root> [exact|extension]');
const allowed=new Set(['device-agent/local-wall.mjs','device-agent/operator-agent.mjs','lib/device-duplex-client.mjs']);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const gitFrozen=f=>execFileSync('git',['show',FROZEN+':'+f],{cwd:repo,maxBuffer:16*1024*1024});
const baseline=JSON.parse(gitFrozen('client/core-files.json'));
assert.equal(baseline.files.length,90,'gold_frozen_count');
const manifest=JSON.parse(fs.readFileSync(path.join(target,'client-core.json'),'utf8'));
assert.equal(manifest.schemaVersion,1,'gold_package_schema');
assert.ok(mode==='exact'?manifest.files.length===90:manifest.files.length>=90,'gold_package_count');
const entries=new Map();
for(const f of manifest.files){
 assert.ok(!entries.has(f.path),'gold_duplicate_package_path:'+f.path);
 assert.ok(!f.path.startsWith('/')&&!f.path.includes('..'),'gold_unsafe_package_path:'+f.path);
 const full=path.resolve(target,f.path);
 assert.ok(full.startsWith(target+path.sep),'gold_package_escape:'+f.path);
 const data=fs.readFileSync(full);
 assert.equal(sha(data),f.sha256,'gold_self_manifest_hash:'+f.path);
 assert.equal(data.length,f.size,'gold_self_manifest_size:'+f.path);
 entries.set(f.path,f);
}
const digest=sha(manifest.files.map(f=>f.path+'\0'+f.sha256+'\0'+f.size+'\n').join(''));
assert.equal(digest,manifest.digest,'gold_package_manifest_digest');
const changed=[];
for(const item of baseline.files){
 const p=item.destination.replaceAll('\\','/');
 assert.ok(entries.has(p),'gold_frozen_file_missing:'+p);
 const actual=sha(fs.readFileSync(path.join(target,p)));
 const expected=sha(gitFrozen(item.source));
 if(actual!==expected){
  if(mode==='exact'||!allowed.has(p))throw Error('GOLD_PARITY_REGRESSION:'+p);
  changed.push(p);
 }
}
const has=(file,conditions)=>{
 const body=fs.readFileSync(path.join(target,file),'utf8');
 for(const [name,pattern] of conditions)assert.match(body,pattern,'GOLD_CONTRACT_MISSING:'+file+':'+name);
};
has('device-agent/local-wall.mjs',[
 ['read_editor',/id="fs-read-roots"/],['write_editor',/id="fs-write-roots"/],
 ['volume_picker',/id="fs-volume-options"/],['save_roots',/id="save-fs-roots"/],
 ['volume_api',/\/api\/filesystem-volumes/],['roots_api',/\/api\/filesystem-roots/],
 ['ab_timer',/refreshAbGrantTimer/]
]);
has('device-agent/operator-agent.mjs',[
 ['set_roots',/setLocalFilesystemRoots/],['owner_policy',/effectiveFilesystemPolicy/],
 ['normalize_roots',/normalizeFilesystemRoots/],['scp_policy',/new LightScpRegistry\(\{policy:/]
]);
has('lib/native-fs.mjs',[['owner_roots',/normalizeFilesystemRoots/],['owner_policy_input',/ownerRoots/]]);
has('lib/light-scp-file.mjs',[['scp_revalidate',/this\._policy\(\)/]]);
has('device-agent/wall-status-cache.mjs',[['bounded_wait',/maxUiWaitMs/],['bounded_helper',/function bounded/]]);
has('device-agent/platform-adapters/shared.mjs',[
 ['cached_windows_exec',/windowsCommandCache/],['cache_invalidated',/invalidateCommandExistenceCache/]
]);
has('device-agent/platform-adapters/windows.mjs',[
 ['inventory_cache',/installedCacheUntil/],['invalidate_inventory',/invalidateInstalledCapabilities/]
]);
console.log('GOLD_486_IMMUTABLE_PARITY_PASS frozen='+FROZEN+
 ' tested_files='+baseline.files.length+' package_files='+manifest.files.length+
 ' mode='+mode+' intentional_additive_changes='+changed.join(','));
