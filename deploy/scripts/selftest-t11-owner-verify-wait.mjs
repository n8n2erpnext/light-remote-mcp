import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const rust=read('client/desktop-v4/src-tauri/src/owner_login.rs');
const win=read('.github/workflows/windows-native-client.yml');
const gc=read('.github/workflows/gold-connection-lifecycle-gc.yml');
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
assert.equal((code.match(/wall_snapshot_after_verification\(\)\.await/g)||[]).length,5);
assert.equal((code.match(/wall_snapshot_current_after_verification\(&snap\)\.await/g)||[]).length,6);
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
assert.match(gc,/node deploy\/scripts\/selftest-t11-owner-verify-wait\.mjs/);
console.log('T11_F10_P02B_OWNER_NATIVE_VERIFICATION_BOUNDED_WAIT_REVOCATION_FENCE_SOURCE=PASS');
