// T11-F16: source-only guard against mistaking a hosted installer smoke
// or ZIP checksum for real Windows Owner/B physical acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const script=read('deploy/scripts/f16-owner-uat-artifact-preflight.mjs');
const test=read('deploy/scripts/f16-owner-uat-artifact-preflight.test.mjs');
const windows=read('.github/workflows/windows-native-client.yml');
const ci=read('.github/workflows/ci.yml');
const plan=JSON.parse(read('deploy/unified/test-plan.json'));
const native=read('client/desktop-v4/src-tauri/src/owner_login.rs');
const vault=read('client/desktop-v4/src-tauri/src/owner_vault.rs');
const source=read('docs/history/pre-reconstruction/docs/project-book/LIGHT_REMOTE_T11_F16_OWNER_B_PHYSICAL_ACCEPTANCE_READINESS_20261108.md');
assert.match(script,/artifact_integrity_only_not_physical_acceptance/);
assert.match(script,/authenticodeSignatureVerified:false/);
assert.match(script,/sourceShaCryptographicallyProven:false/);
assert.match(script,/ownerBApproved:false/);
assert.match(script,/physicalWindowsAccepted:false/);
assert.match(script,/createReadStream/);
assert.match(script,/pe_signature_invalid/);
assert.match(script,/checksum_mismatch/);
// Win32 realpath normalizes existing regular file aliases; lstat still rejects
// direct symlink files and both resolved parent directories must match.
assert.match(script,/process\.platform!=='win32'&&resolved!==path\.resolve\(target\)/);
assert.match(script,/st\.isSymbolicLink\(\)/);
assert.match(script,/path\.dirname\(exe\.path\)!==path\.dirname\(sums\.path\)/);
assert.doesNotMatch(script,/node:child_process|\bspawn\s*\(|\bfetch\s*\(|\bhttps?\.get\s*\(|\bhttps?\.request\s*\(/);
assert.match(test,/corruption|tampered|mismatched checksums/);
assert.match(windows,/node --test deploy\/scripts\/f16-owner-uat-artifact-preflight\.test\.mjs/);
assert.match(windows,/--source-sha \$env:GITHUB_SHA/);
assert.match(windows,/F16_OWNER_UAT_INTAKE\.json/);
const hash=windows.indexOf('      - name: Hash Windows installers');
const intake=windows.indexOf('      - name: F16 verify complete Setup.exe artifact intake');
const upload=windows.indexOf('      - name: Upload ONE complete Windows Desktop V4');
assert.ok(hash>=0&&hash<intake&&intake<upload,'read-only intake must follow hash and precede artifact upload');
assert.match(windows,/F16_PHYSICAL_OWNER_B=NOT_TESTED; SIGNED_FEED=HOLD/);
assert.ok(ci.includes('npm test'));
assert.ok(plan.extraUnitFiles.includes('deploy/scripts/f16-owner-uat-artifact-preflight.test.mjs'));
assert.match(native,/desktop_owner_begin/);
assert.match(native,/desktop_owner_restore/);
assert.match(native,/desktop_owner_logout/);
assert.match(vault,/Windows Credential Manager, Apple Keychain and Linux Secret Service/);
assert.match(source,/Owner manually approves B/);
assert.match(source,/rollback/);
assert.match(source,/NOT RUN/);
assert.match(source,/not authorization to install/);
console.log('T11_F16_READ_ONLY_INNER_INSTALLER_INTAKE_AND_PHYSICAL_B_HOLD=PASS');
