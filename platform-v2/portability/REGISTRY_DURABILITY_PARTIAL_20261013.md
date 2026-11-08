# rc50 P0 — First real registry durability batch (2026-10-13)

**WORKTREE:** /home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/rc50-v2-platform
**BRANCH:** feature/rc50-mjs-scale-20261011
**BASE:** 371984811ae577cf10a7fd4e0db2cc04d51b6834
**SCOPE:** Source changes only in rc50 dev worktree, NOT deployed/production. Goal from finite [P0 closure gates](./RC50_P0_CLOSEOUT_GATES_20261013.md): reduce the **actual Operator/Plugin JSON writer durability gap**, not make a new synthetic grant/verifier component.

## What changed in product source
New shared `lib/durable-atomic-file.mjs`: synchronized single-file replacement. Validates absolute path and parent/target type/mode, uses unpredictable 128-bit random temporary path and `O_EXCL|O_NOFOLLOW`, writes full byte buffer, `fchmodSync`, `fsyncSync` the file, renames, `fsyncSync` the parent directory. Errors cause a **sticky process-local durability failure latch**. This does NOT provide group-of-files transaction, cross-process authority, global writer election/fence or failure recovery.

Converted **5 of the 18 inventoried writer surfaces** on actual dev Operator modules:
1. `operator-host/device-registry.mjs`: DEVICE_STATE_FILE.
2. `operator-host/enrollment-registry.mjs`: ENROLLMENT_STATE_FILE + ENROLLMENT_SIGNER_FILE. Newly minted private Ed25519 signing material is no longer directly truncated in-place.
3. `operator-host/host-device-identity.mjs`: HOST_DEVICE_IDENTITY_FILE + HOST_COMPANION_STATE_FILE.

The 9 other Operator writers and all 4 Plugin writers **remain unchanged**, not durability-proven; `device-connection-registry.mjs` was briefly partially edited but a structured edit was **blocked by tool safety**. Its partial edit was **restored to the clean baseline** via `git restore -- operator-host/device-connection-registry.mjs`; do not evade that block with PTY, scripts or alternative tools. All other attempted wholesale file rewrites were reverted when safety redaction made copied source invalid. Final successful source changes used small structured `edit_file` replacements, preserving actual key-material code intact; `node --check` PASS.

The source audit `platform-v2/portability/audit_writer_freeze_readiness.py` now explicitly distinguishes 5 converted writers with imported, actual `durableAtomicWriteSync` and helper fd/dir sync invariants from 13 unchanged JSON writers. Its output correctly remains `status=NOT_READY, fsync_proven=5, fsync_not_proven=13, single_writer_authority_proven=false`. No global fence, multi-file checkpoint or restore acceptance asserted. The manifest `writer-freeze-readiness.json` and negative regression tests track the five source paths and reject forged global writer readiness.

## Validated on VPS-ARM
```sh
node --test platform-v2/test/test-durable-atomic-file.mjs
# 7/7 PASS: real filesystem atomic replace, mode 0600 and 0640,
# injected file+directory fsync errors, sticky latch, symlink/hardlink denial
node --test platform-v2/test/test-actual-durable-registry-integration.mjs
# 1/1 PASS: instantiate/reload real DeviceRegistry,
# EnrollmentRegistry and host device identity/companion with fake test-only data
python3 -B platform-v2/portability/audit_writer_freeze_readiness.py
# PASS / NOT_READY: fsync_proven=5, fsync_not_proven=13
python3 -B platform-v2/test/test_writer_freeze_readiness.py
# 11/11 PASS
node --test platform-v2/test/*.test.mjs
# 34/34 PASS
node platform-v2/test/test-audit-append-barrier.mjs
# 8/8 PASS
node --test platform-v2/test/test-durable-audit-append.mjs
# 7/7 PASS
node --check operator-host/{device-registry,enrollment-registry,host-device-identity}.mjs
node --check lib/durable-atomic-file.mjs
git diff --check
# PASS
```
All integration tests use temporary files created and removed by the test in an OS temporary folder. Test keys are generated locally but never logged to chat. Neither production nor staging devices/data/secrets, Git main, billing, network, operator process, Docker volume or real Agent were modified.

## P0 acceptance still OPEN
- **P0-A**: a single global writer epoch/fence enforced by all Operator/Plugin/Fleet/PTY mutators remains NOT_READY.
- **P0-B**: real A/B Local Wall consent + authenticated verifier/issuer trusted PostgreSQL principals not proven.
- **P0-C**: durable audit append was patched in previous commit, **5/18** JSON writers now updated but **13/18** remain; support pump/drain, PTY job fence, multi-file consistent checkpoint/watermark not proven.
- **P0-D**: true cross-host restore+rollback of complete fake representative state/identity, native ABI and exactly-one-writer is unverified.
- **P0-E**: full integrated UAT release/CI gate not proven.

**Next**: address remaining 13 writers only through the permitted structured editing interface; if blocked, record blockers and shift to independent P0 gate requiring no evasion. After durability coverage, implement actual shared writer ingress/freeze boundary and drain, not more synthetic signature/nonce models. Keep Node ESM .mjs+Express5.
