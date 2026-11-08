import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
// GitHub Windows checkout uses CRLF: split the Rust test section only
// after canonicalizing line endings, never relax the actual Owner checks.
const rust=read('client/desktop-v4/src-tauri/src/owner_login.rs')
  .replace(/\r\n/g,'\n');
const win=read('.github/workflows/windows-native-client.yml');
const ci=read('.github/workflows/ci.yml');
const plan=JSON.parse(read('deploy/unified/test-plan.json'));
const desktop=read('.github/workflows/desktop-v4-native-ci.yml');

assert.match(rust,/const OWNER_VERIFY_WAIT_MAX: Duration = Duration::from_millis\(2500\)/);
assert.match(rust,/const OWNER_VERIFY_WAIT_TICK: Duration = Duration::from_millis\(40\)/);
assert.match(rust,/async fn wall_snapshot_after_verification_with_budget\(/);
assert.match(rust,/async fn wall_snapshot_current_after_verification_with_budget\(/);
assert.match(rust,/async fn wall_wait_for_verified_anchor\(/);
assert.match(rust,/s\.phase!="verified" \|\| s\.generation!=snap\.generation/);
assert.match(rust,/s\.account_id\.as_deref\(\)!=Some\(snap\.account\.as_str\(\)\)/);
assert.match(rust,/s\.access_token\.as_deref\(\)!=Some\(snap\.access\.as_str\(\)\)/);
assert.match(rust,/prior\.map_or\(true,\|before\|t>before\)/);
assert.match(rust,/tokio::time::sleep\(OWNER_VERIFY_WAIT_TICK\)\.await/);
assert.match(rust,/if Instant::now\(\)>=deadline\{return false;\}/);
assert.match(rust,/self\.wall_snapshot_current\(snap\)/);
assert.match(rust,/if !self\.wall_wait_for_verified_anchor\(&anchor,prior,budget\)\.await/);
assert.match(rust,/fn wall_snapshot\(&self\)[\s\S]*?s\.phase!="verified" \|\| s\.status_inflight/);
assert.match(rust,/fn wall_snapshot_current\(&self,snap:&NativeOwnerWallSnapshot\)[\s\S]*?s\.phase=="verified" && !s\.status_inflight/);
const code=rust.split('#[cfg(test)]\nmod tests {')[0];
assert.doesNotMatch(code,/runtime\.wall_snapshot\(\)\?/);
assert.doesNotMatch(code,/runtime\.wall_snapshot_current\(&snap\)/);
// F14 adds an independently gated Owner inventory read. Keep the original
// F10 regression counts scoped to its original code, and enforce the new
// read has its own positive Owner verification and generation fence.
const f14Start='// T11-F14: one verified Owner inventory page.';
const f14End='// T05: Real owner-bound pending A/B V2 and B approval via OS-local Agent.';
const sections=code.split(f14Start);
assert.equal(sections.length,2,'F14 native read must have an explicit boundary');
const after=sections[1].split(f14End);
assert.equal(after.length,2,'F14 native read must close before existing approval');
const baseline=sections[0]+after[1];
assert.equal((baseline.match(/wall_snapshot_after_verification\(\)\.await/g)||[]).length,5);
assert.equal((baseline.match(/wall_snapshot_current_after_verification\(&snap\)\.await/g)||[]).length,6);
assert.equal((after[0].match(/wall_snapshot_after_verification\(\)\.await/g)||[]).length,1);
assert.equal((after[0].match(/wall_snapshot_current_after_verification\(&snap\)\.await/g)||[]).length,1);
assert.match(after[0],/verify_owner_session\(&access,&account\)/);
for(const test of [
 't11_f10_verify_inflight_bounded_wait_accepts_same_owner_only_after_https_success',
 't11_f10_mid_read_verify_success_preserves_old_generation_projection',
 't11_f10_revocation_during_verify_cannot_approve_or_project_owner_data',
 't11_f10_signout_during_wait_does_not_switch_to_new_owner',
 't11_f10_refresh_rotation_during_wait_rejects_original_owner_token',
 't11_f10_stuck_verification_is_bounded_and_never_grants',
 't11_f10_cleared_inflight_without_positive_https_timestamp_denies'
])assert.ok(rust.includes('fn '+test+'()'),'missing native Rust race fixture '+test);
assert.match(desktop,/cargo test --manifest-path src-tauri\/Cargo\.toml --features desktop-owner-login --bin light-remote-desktop-v4-pilot/);
assert.match(win,/node deploy\/scripts\/selftest-t11-owner-verify-wait\.mjs/);
assert.ok(ci.includes('npm test'));
assert.ok(plan.sourceRegressions.includes('deploy/scripts/selftest-t11-owner-verify-wait.mjs'));
console.log('T11_F10_P02B_OWNER_NATIVE_VERIFICATION_BOUNDED_WAIT_REVOCATION_FENCE_SOURCE=PASS');
