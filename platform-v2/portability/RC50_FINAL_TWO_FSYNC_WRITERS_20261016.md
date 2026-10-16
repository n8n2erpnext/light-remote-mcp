# rc.50 P0-C — close the final two individual-file fsync gaps (18/18)

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline HEAD: `425d2b447bcee4e5fbca1fd3df67622a34e9908c`
Branch: `feature/rc50-mjs-scale-20261011`
Scope: strictly individual-registry persistence in the feature-branch source; no production deploy, no Main merge, no authentic source fencing.

## Actual source defect and changes

Read-only audit `platform-v2/portability/audit_writer_freeze_readiness.py` correctly identified two remaining unflushed legacy writers of the 14 Operator + 4 Plugin critical registry planes:

1. `operator-host/account-registry.mjs` `AccountRegistry._persist()`: wrote a predictable PID-named temp through `fs.writeFileSync` then chmod and `fs.renameSync`, without an explicit file and directory fsync before reporting success. This registry contains authentication accounts, sessions, reset/one-time-token hashes, identity and entitlement state.
2. `operator-host/device-connection-registry.mjs` `DeviceConnectionRegistry._persist()`: identical pattern without file/directory fsync. This registry represents connection lease and device ownership state.

Both now call the already-existing audited `durableAtomicWriteSync(this.stateFile, JSON-string, {mode:0o600})` after creating their containing directory. The shared helper uses unpredictable `O_EXCL|O_NOFOLLOW` temp files, rejects symlinks and non-private parent directories, performs complete writes, fchmod, **fsync(temp file)**, close, atomic rename, **fsync(parent directory)**, and returns an ACK only after both flushes. On write errors its default process-wide instance latches the error and rejects subsequent writes in that process. No registry schema fields, data, state shape, OAuth signing, network, command or device runtime routing were changed.

The corresponding two entries in `platform-v2/portability/writer-freeze-readiness.json` changed from `fs.writeFileSync(`/synchronous-process-io-only/`fsync_proven:false` to `durableAtomicWriteSync(`/sync-file-and-parent-directory/`fsync_proven:true`. Both still explicitly declare `source_fence_proven:false` and `consistent_generation_proven:false`. The manifest status remains `SOURCE_OBSERVATIONS_ONLY_NOT_RESTORE_READY`. The source audit is **18/18 individual-file fsync-proven**, **NOT_READY**.

`platform-v2/test/test_writer_freeze_readiness.py` updates its expected proven count and retains negative mutation tests; turning an established durable writer into unsupported `fsync_proven:false` still fails the audit. No fake P0 signoff.

## Independent actual registries and negative tests

`platform-v2/test/rc50-last-two-durable-writers.test.mjs` runs real production-source AccountRegistry / DeviceConnectionRegistry classes exclusively on disposable temp dirs:

1. Actual AccountRegistry writes 0600 JSON, reloads new instance and recovers a synthetic group; no predictable temp.
2. Actual DeviceConnectionRegistry creates, reloads, renews, disconnects a synthetic connection lease across independent instances; 0600 file.
3. New subprocess injects failure at *file fsync* in account persistence: no success ACK, no destination JSON and no residual temp.
4. Equivalent file-fsync failure in connection registry.
5. Both registries reject an existing symlink destination without modifying the sentinel target; each run isolated in its own Node subprocess because the default writer latches errors.
6. New subprocess injects failure at *directory fsync after rename* in account writer: the JSON may already be visible, but no success ACK; further calls in same process remain poisoned.
7. Equivalent parent-dir-fsync ambiguity and permanent write denial for connection registry.

Focused regression **7/7 PASS** on real VPS-ARM Node. Source audit observed `fsync_proven:18`, `fsync_not_proven:0`, `single_writer_authority_proven:false`, `status:NOT_READY`.

## Trust and crash boundaries still NOT solved

Individual atomic fsync does **not** establish a cross-file transaction between AccountRegistry, DeviceConnectionRegistry, Operator, Plugin, Fleet, Agent, PostgreSQL, Redis or Paddle. An ambiguous error after rename and before fsync directory can leave file bytes visible; even process-level write latching cannot establish whether the previous write survived physical power loss. This is a conservative UAT test, **NOT** real power-loss or disk failure verification.

No authoritative global WriterEpoch/lease, fencing of stale writers on all write paths, independent Owner B issuer, Agent process/PTY/desktop/SCP side-effect inventory, authoritative WAL settlement, cross-host consistent snapshot/restore or production-equivalent end-to-end cutover exists. Five critical dependent barriers stay open: EVENT_LOG_ASYNC, SUPPORT_BACKGROUND_PUMP, FLEET_PROCESS_COMMAND_MAP, OAUTH_PROCESS_REPLAY_MAP, GOOGLE_PENDING_LOGIN_MAP. No service in production has been updated with these changes.

Required future work is global write-path fencing before allowing another host to become writer, complete source freeze/drain, trusted signed checkpoint and authoritative reconciliation; after that a representative end-to-end release test. **P0-A/B/C/D/E remain NOT_READY.**

## Consolidated verification before commit

Run:
`node --test platform-v2/test/*.test.mjs`
`python3 -B platform-v2/test/test_writer_freeze_readiness.py`
`python3 -B platform-v2/portability/audit_writer_freeze_readiness.py`
`python3 -B platform-v2/test/test_p0_release_gate.py`
`python3 -B platform-v2/scripts/p0-release-gate.py --report`
`python3 -B platform-v2/scripts/p0-release-gate.py --require-ready` — expected DENY exit 3.
`git diff --check` and Node syntax check. CI must verify exact commit native ARM64/x64 and isolated-data-contract jobs. Do not interpret PASS of the preceding commands as P0 release ready.
