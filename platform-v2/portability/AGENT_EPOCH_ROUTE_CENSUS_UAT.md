# Light Remote rc50 P0 — synthetic Agent generation and source route census

Checkpoint: 2026-10-12 (Asia/Ho_Chi_Minh). **Scope: isolated rc50 development worktree ONLY.** No deployed Operator/Plugin/Agent modified or restarted; no real Fleet, PTY, desktop, credential, customer JSON, billing or API calls made. This is **NOT** a release acceptance or independent backup.

## A. Device-side prototype (not wired)

Files:
- `platform-v2/portability/synthetic-agent-generation.mjs`
- `platform-v2/test/test-synthetic-agent-generation.mjs`

`SyntheticAgentGeneration` accepts only a real direct child of `os.tmpdir()` whose name starts `lr-rc50-agent-fixture-`, with one exact `receipts.json` path. On reopening an existing file it checks real regular file, no symlink and restrictive permissions before parse. State writes use `writeSyntheticJsonDurably` from earlier rc50 source-only UAT (exclusive temp, complete write, file fsync, rename and parent directory fsync); after an error the instance is poisoned and refuses further commands.

The **synthetic** control proof `uat_ctrl_...` is just a format marker, **NOT a signature, identity or owner authorization**. `advanceEpoch` persists only increasing generations and never revives old commands. The envelope must have `uat_agent_...` agent ID, `uat_cmd_...` command ID, current generation and a strict `{kind:'fake_noop',message:'...'}` payload. Duplicate same command ID/envelope returns `duplicate_no_execution`; same ID but modified payload is rejected. A newly accepted receipt is durably persisted before the test-only `startFake`; `startFake` persists STARTED, then `completeFake` persists COMPLETED and a fake result digest. It **never executes a callback or OS command**.

After restart any ACCEPTED or STARTED receipt is marked UNCERTAIN and **not replayed automatically**; after generation advance ACCEPTED is FENCED and STARTED becomes UNCERTAIN. Repeated START/complete denied. Completed receipt remains for duplicate suppression. A SHA-256 digest is a consistency check, not authenticated provenance.

Node tests: **17/17 PASS**, including persisted epoch and completion, duplicate/conflicting command, generation downgrade denial, crash/reopen uncertainty, in-flight fence, invalid payload/identity, path escape, symlink, world-readable existing receipt rejection and injected fsync failure. All tests use disposable synthetic fixture directories and do not touch a real Agent.

**Limitations:** no cryptographic owner proof, no certificate pinning, no persisted global authority lease, no cross-process on-device lock, no concurrent Agent writers, no authenticated grant revocation, no OS-side cancellation, no durable proof that an external command did/did not execute. An ambiguous filesystem failure after rename is still ambiguous. No real-world at-most-once claim. Future Agent code must reject stale epochs and false owner grants at *dispatch and immediately before physical execution*, retain an idempotent receipt across reboot and reconcile UNCERTAIN side effects with a trusted authority. Do not automatically redispatch a PTY or desktop action because its receipt was missing.

## B. Source-wide potential mutator inventory

Files:
- `platform-v2/portability/census_mutating_routes.py`
- `platform-v2/portability/mutating-route-census.json`
- `platform-v2/test/test_route_census_source.py`

The source-only scanner examines `operator-host/executor-routes-*.mjs`, `operator-host/executor.mjs` and top-level `plugin-server/*.mjs` excluding explicit `selftest` fixtures. It records the exact source path, file SHA-256, line number, potential POST/PUT/PATCH/DELETE methods and literal path hints, without copying complete source lines, request bodies or secrets. Timer/async pump/enqueue/poll candidates appear separately.

**Observed report:** 32 source files, **163 candidate mutation code sites**, **28 candidate background/dispatch code sites** and 7 required critical source file groups. These are **occurrences**, NOT 163 distinct registered endpoints. Dynamic route strings, conditional branches, middleware, delegated handlers, WebSocket/long-poll protocol effects, side-effecting GETs and external provider callbacks can escape a regex/line-based scanner. Every site is labeled `source_candidate_manual_verify`; all require human review and the manifest expressly states `global_epoch_wired:false`.

**7/7 Python source-census tests PASS**: deterministic regeneration, checksum agreement, scope, necessary sources, conservative classification and result counts. There is **NO** runtime routing test and NO claim of complete mutation coverage.

## C. Integration order (next P0; preserve fail-closed behavior)

1. **Human classify every source candidate** into read-only, durable account/device/grant/usage/billing write, session/OAuth replay mutation, real OS command, external webhook/outbox, or timer/background maintenance. Bind routes/methods/dynamic actions to exact middleware interception point. Eliminate all unreviewed side-effect routes before enabling the global fence.
2. Establish trusted owner-authorized PG epoch/fence service with least-privilege roles (prior role provisioning was safety-blocked), explicit global write-block, lease renewal and monotonic generation; never treat synthetic controlProof as proof.
3. Attach DB transactional assert/serialized outbox to every authoritative mutator; enforce persistent generation+authorized device binding at Agent before physical action; restrict remote delivery of old envelopes.
4. For PTY/Fleet and nontransactional operations use bounded job drain, OS process evidence, device receipts and reconcile UNCERTAIN after restart. Older generation cannot start new work even if an old queue is reconnected. Command redelivery must be safe and never create duplicate billing/usage charges.
5. Pause/fence Plugin billing/support timers and OAuth token consumption, preserve Paddle event ID and ERPNext order/refund/idempotency, A/B grant revocation and sensitive identity continuity.
6. Only then exercise independently reviewed nonproduction multi-node lifecycle, sealed backup, restore and rollback; **previously blocked AES runtime, two-stack Docker cold move, DB role provisioning, and post-manifest combined regression remain blocked** and cannot be rerun via PTY or another interface.

Source of truth: Node.js ESM `.mjs` + Express 5. This is the rc50 portability foundation, not the parked post-rc50 DesktopCommander optimization backlog. No production rollout.
