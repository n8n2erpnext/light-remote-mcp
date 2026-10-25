# Gold Memory Sync — Account-wide per-device modes (2026-10-25)

## Owner product requirement

From ANY enrolled Gold Wall in one Account, configure the SAME canonical device list:
- One **Sync ON/OFF** control for the Account. OFF pauses transfers without deleting already received local data or issuing grant rotations.
- Checkbox per enrolled device. Unchecked stops future shared updates/recipient grants. Checkboxes and modes stay visible across all Walls.
- Three selectors BEHIND each selected device: **Auto / Follow Project / Manual**, independent per device. ARM Auto, Windows Manual and macOS Follow Project must work together.
- Manual device has a small **Sync now** operation. No Home URL, IP, copy/paste key, fingerprint or second-Wall accept ceremony. Require owner Wall auth+CSRF and signed Agent enrollment.
- The **sync mode** is a transport policy for the device, NOT the separate **capture mode** for an individual scope. Codex Bridge remains independent.

## Meaning of per-device sync mode

**Auto**: when Account Sync is ON and the device is checked, automatically exchange *authorized* checkpoint deltas and signed evidence with corresponding scope Homes.

**Follow Project**: only exchange scopes with a verified binding of workspace, repository or work_context. Unbound scopes remain unassigned/unsynced; NEVER infer membership from displayName or fuzzy matching. Scope Home remains authoritative.

**Manual**: no automatic delivery of new Home revisions. The owner clicks **Sync now**. Operator increments a durable per-device manual_request_seq; every scope Home snapshots the authorized head revision for that request in local SQLite. Only revisions at or below that ceiling can be sent, even after a later checkpoint is created. A new request can advance the ceiling.

Each device may have a different mode, even when both store replicas of the same scope. Home-side and receiver-side policy gates BOTH apply. A different device can be Home for a different scope; the Wall being open is NOT the default Home for the whole Account.

## Data boundaries

- Operator PostgreSQL canonical metadata ONLY: normalized `lr_gold_memory_sync_accounts` and `lr_gold_memory_sync_devices` tables with account_id, device_id, checked, mode, revision/CAS and manual sequence. NO checkpoint payloads, transcript, secrets or JSONB snapshot tables.
- Redis is Gold runtime transport/cache when applicable, NOT canonical Memory data.
- Device local SQLite continues to own scoped checkpoints, verified event journal, signatures, outbox/ACK and durable per-scope Manual ceilings.
- Account policy cannot grant other-account device IDs; signed enrollment binds every Agent channel to account ID and device ID. Local Wall mutation requires owner authentication + CSRF. Server MUST recheck account roster/disabled policy before relaying ciphertext or forwarding invitations.
- Gold Relay may hold only bounded TTL E2EE frames in RAM, never PG/Redis/disk/log payloads. Prefer direct P2P when safe and capable; both transports respect the same Sync OFF and per-device mode checks.
- Disabling Sync does not revoke existing local copies. Unchecking a device revokes future membership/grants when each Home reconciles its scoped authorizations; allow for propagation latency/offline sources. No promise of secure remote deletion.
- Device key rotation must fence old grants; one Home writer per scope and home_epoch avoids split-brain.

## Integration code slice

- `operator-host/gold-memory-account-sync-policy.mjs`: normalized PG account policy + CAS and manual trigger.
- `operator-host/executor-routes-device-channel.mjs` / `plugin-server/device-public.mjs`: enrollment-signed get/set/manual and account-selected relay/invite gates.
- `device-agent/operator-agent.mjs`: account policy polling, per-device membership/mode and Home/Replica sync policy gating; invite offers remain signed and local checkpoint content is E2EE.
- `device-agent/gold-wall-modules.mjs`: verified project binding check and durable Manual revision ceiling per scope/peer.
- `device-agent/local-wall.mjs`: unified account device rows and per-row 3-mode choices, Home P2P policy checks, owner+CSRF writes.
- `deploy/scripts/selftest-gold-memory-device-modes.mjs` / `selftest-gold-memory-account-ui.mjs`: three different device modes, account isolation, stale policy revision, Manual ceiling, owner+CSRF, cross-Wall consistency at mock transport boundary.

## IMPORTANT gates NOT accepted by these source unit tests

1. On Gold UAT, PostgreSQL migration/table initialization, signed Device Channel roundtrip and exact cross-Wall persisted policy must be verified after deployment. Unit PG harness is not a live database acceptance.
2. Both UAT ARM and Windows need compatible Gold Agent code; Windows staged candidate alone is not an installed/runtime verification. Perform 2 encrypted checkpoint revisions, ACK, offline/reconnect and Manual revision fencing on REAL devices.
3. **Replica → Home signed typed event/evidence contribution** is not yet covered by existing checkpoint-only G3 protocol. It needs durable outbox, authorized source scope routing, Home re-ingestion and single-authority coalescing, rather than multiple writers.
4. Home directory by scope, multi-device manifest/hash divergence reconciliation, source provenance, quarantine, fail-closed stale replica restore and authenticated Home migration need separate E2E gates. Account-global policy should not be confused with a global canonical Home.
5. Follow Project cross-OS real project bindings (Windows/Linux/macOS paths) and true P2P prioritization per device mode need OS parity acceptance. Do not mark G3/G4/G5/G6 fully PASS from source tests.
6. Owner-intent security assurance: the signed device channel is a trusted agent acting for an owner-authenticated Wall. A future hardening pass should explicitly bind owner approvals to a server-verifiable short-lived principal without requiring routine extra user prompts.

## Source/rollback

Branch `feature/gold-m6-integrated-20261023` only. Keep Gold production untouched, source rollback tag `gold-restore-before-memory-codex-20261024`, and UAT LXD snapshot `gold-before-one-switch-memory-sync-20261025`. Do not restart active Windows client without verified recovery and owner-aware rollout. Legacy per-Home `lm_sync_device_selection` is kept for backward compatibility but MUST NOT be the policy backing the new Account-wide UI.

## UAT 2026-10-25 11:40+07 (verified, not planned)

- Source HEAD `55a28ee377aa4894567737359cd3e29a9b8d7de5`, Gold UAT current four systemd services `active` on matching SHA, only LXD `light-remote-gold-uat`; no Gold production change. Pre-schema snapshot `gold-before-account-sync-sql036-20261025` exists.
- Initial UAT signed device-channel GET failed because `lr_gold_app` intentionally lacks `CREATE` on public schema. Resolved with migration `036_gold_memory_account_sync_modes.sql` applied ONCE by separate `lr_gold_migrator`, manifest hashes verified. SQL ledger version `36`, Operator remains DML-only (no extra privileges).
- Actual enrolled UAT device made signed `memory-sync-policy?action=get` via Gold Plugin to Operator; verified two devices, revision `0`, global Sync `OFF`, both devices unselected, default individual mode `Auto`; checkpoint payload transfer `false`. **Real PostgreSQL READ gate PASS.**
- `db9c438` updates old CI source contract to locate immutable SQL 035 by version instead of assuming 035 remains last; `55a28ee` fences old clients without `syncModeProtocol=1` from granting or accepting Memory changes. GitHub Gold Native Wall Modules Parity for `55a28ee` succeeded at last query; Windows/Linux/Operator workflows may still be in progress.
- On real Windows `DESKTOP-VA16D27`, installed client does **not** yet implement `memoryAccountSyncPolicy`. The new source `55a28ee` is staged separately under `%LOCALAPPDATA%\\Light Remote\\G3-DeviceMode-55a28ee`: 101/101 hash-verified files and per-device-mode tests PASS, **NOT INSTALLED**. Owner-facing UI must show this outdated device as not yet mode-capable. No Windows install/restart executed.
- Remaining gates: real owner Account policy WRITE/read-back across independent Walls, Windows runtime upgrade plus real Home↔Replica checkpoint+ACK/offline reconciliation, Replica→Home typed evidence, per-scope authoritative Home routing/multi-device manifest and true multi-OS parity. Never claim full G3/G4/G5/G6 PASS from metadata/unit tests.

## 2026-10-25 — English Wall and real UAT ↔ Windows installer acceptance

- Source tested: `ccd102b8146dd994e6b0f7f205e43aa4caf3050c`, branch `feature/gold-m6-integrated-20261023`. All remaining Vietnamese visible strings in `device-agent/local-wall.mjs` converted to English. Wall UI/account-policy and filesystem owner regression tests passed, Gold Native Wall Parity CI passed.
- UAT LXD snapshot: `gold-before-english-windows-sync-20261025`. UAT four services (Operator, Plugin, Supervisor, Wall) active on `ccd102b` and retained PostgreSQL migration ledger v36; production ARM host/Wall unchanged.
- Windows Tray CI official installer run `40165305011` SUCCESS: artifact `light-remote-windows-x64-ccd102b8146dd994e6b0f7f205e43aa4caf3050c`, ZIP SHA-256 `a20eac9b5bae63fead3db29f44893edb6fdb87dda8d855e8b35e5ac6d2065030`; full installer `175279272` bytes SHA-256 `62b24c5aa70a403d6ef86f03ca6eae01c8531e6e413ad88e3ec43ef150f999b4`. Verified on Windows before install.
- Windows `DESKTOP-VA16D27`: backed up 418 installed-client files + Scheduled Task export under `%LOCALAPPDATA%\\Light Remote\\Gold-UAT-ccd102b\\backup`. Installed full UAT Windows installer through independent task, receipt `RESULT=PASS`. Running Agent task recovered; installed `operator-agent.mjs`, `local-wall.mjs` and `gold-wall-modules.mjs` SHA-256 equal verified candidate source `ccd102b`. One-time install task and temporary 328MB ZIP removed; rollback backup and 175MB full setup retained.
- Initial owner Account policy was `revision=4`, `enabled=true`, Windows selected Auto; UAT ARM *unselected* Auto. To run two-device acceptance, used the enrolled UAT Agent's signed Operator channel to temporarily select ARM too (`revision=5`). Both Agent identities advertised `syncModeProtocol=1`. Test was scoped to the existing `G3 NETBIRD DIRECT SYNTHETIC UAT` and `Gold G2 Auto UAT (2026-10-24)` scopes only.
- **Real E2E PASS, not synthetic courier**: Windows local SQLite was initially 0 scopes, then automatically received both ARM Home scopes. Windows independently called `goldScopedHandoff` from installed source: both revision 1 signed Home checkpoints verified, with head hashes `0a0e4cd5f7387e37516dddef3e89b7354d6804289c3b71f3f2f9e81bd7df67df` and `76ee47d9fdcf20d45f3778357c949d686013bb2b1cfbfc4d26c64d1b343a36fa`. Home durable SQLite `lm_replica_ack` reported revision 1 for both.
- A second, clearly marked synthetic checkpoint was written exclusively by the UAT Home onto scope `7a115f4f-bbed-4565-8493-31fa92ebebb3`. New revision=2 signed `home_ed25519_signed`, hash `a8d7ed2f689e890ca343455725e8212723fd216f31680234015dd1511a4f3fcd`. Windows automatically received revision 2, independently verified signature and chain with exact same hash, and ARM received **ACK revision 2/2**. No database copying or ChatGPT courier.
- Owner's original Account device selection **restored** after test at revision 6: `Sync ON`, Windows selected/Auto, ARM unselected/Auto. Synced ciphertext-derived local Memory copies remain; no remote deletion is claimed.
- **Not yet PASS**: Replica→Home signed typed event contribution; multi-scope Home routing from different sources; P2P direct prioritization on real Windows; Follow Project and Manual E2E with real Windows; offline/reconnect revision divergence; full ChatGPT new-session scoped restore; macOS parity. Owner UX has one issue to examine separately: selecting only Windows but not the UAT Home prevents ARM-originated sync, so the UI should clearly communicate source membership or handle implicit Home participation. Do not turn this into extra required IP/JSON steps.


## 2026-10-25 — English UI, Windows Gold UAT, real Manual E2E and Codex ACL RCA

**Release source:** `8a8c40c3f998032ab25b6cfbf54f3935d61ce70f` in `feature/gold-m6-integrated-20261023`, after `ccd102b` English Wall and `1658567` earlier E2E handoff. Gold UAT LXD `light-remote-gold-uat` four services `active`, running source `8a8c40c`. UAT pre-upgrade snapshot `gold-before-codex-acl-and-sync-status-20261025` exists. **Do not alter Gold production or rollback tags.**

Windows native installer was built from the exact source SHA by [Windows Tray Client CI run 40167770765](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/40167770765), with **four CI workflows green** (Windows, Gold Native Wall Modules Parity, Gold G3 Operator Regression and Linux Packages). Artifact `light-remote-windows-x64-8a8c40c3f998032ab25b6cfbf54f3935d61ce70f` ZIP SHA256 `63a3c89a97ac180d0fe3df50b84be1178f22afc8631661569482db0612178ef5`, full installer SHA256 `05d8c3edc0893005ed251177505d777ff1f8e423cb2d82d8c5cb93338ef70d5e`. Installer staged under Windows `%LOCALAPPDATA%\\Light Remote\\Gold-UAT-8a8c40c\\installer\\`, old client backed up in that directory's `backup\\installed-client`, installed in existing per-user AppId via independent temporary Scheduled Task, and the temporary installer task was removed afterward.

**Windows install verified:** installer exit 0; independent stage and verification of **101/101 client core files**; exact SHA-256 file comparison PASS for `operator-agent.mjs`, `local-wall.mjs`, `gold-codex-plus.mjs`, `gold-wall-modules.mjs`; scheduled `LightRemoteDeviceAgent` Running; signed scoped Memory record validation on Windows PASS. An early scripted post-install validation erroneously used positional PowerShell `Select-String` arguments, causing a **false FAIL receipt** after a successful installer exit. Initial error is preserved as `initial-validator-false-negative.txt`; corrected independent receipt in `install-result.txt` documents PASS. Do not confuse this validation-script bug with installer failure.

**Real G3 Account E2E test:** devices `dev_e68276c691ba5413f42d5dde` (Home ARM) and `dev_8d0715fce77efffce4c5ed28` (Windows). Owner Account Sync ON, both selected, each Auto before test. Existing synthetic scope `7a115f4f-bbed-4565-8493-31fa92ebebb3` had Home=ARM, replica Windows, **revision 2/2 signed ACK verified**. Switched **only Windows** to Manual using signed Account policy revision 10, appended a synthetic signed Home checkpoint revision 3, observed Windows held revision 2 and Home ACK 2. Issued `memory-sync-policy action=manual` with durable `manualRequestSeq=1`; Home set local Manual cap to revision 3, reauthorized encrypted grant `grant_epoch=3`, Windows received signed revision 3, Home persisted signed ACK **3/3**. Win head hash `fea737052ba96230f33acc3f7e9b598c61a34a9574865f6509f94dc95bd33fea` matches Home. Thus **real Auto and Manual Home → Windows → ACK gates PASS** on actual devices, without copying the database between hosts.

**Post-test Account policy:** An interleaved owner/UI update advanced policy revision to 12. The scripted restore intentionally failed CAS instead of overwriting that newer config. Fresh signed read confirmed global Sync `enabled=true`, **both ARM and Windows selected, both mode=auto**, Windows manual_request_seq=1 (historic counter only). Do not call a forced restore; desired user-visible policy is already Auto on both. In later sessions, always read current policy, not the historical revision.

**UI corrected:** all Gold Memory Sync user-facing Vietnamese strings translated into standard English; changed the hardcoded misleading `Awaiting verified revision` label into `Sync enabled · Check scope revisions`. This does **not** claim live per-device revision telemetry; actual signed revision and ACK state remains in local scoped Memory ledger. Designing a true account-level per-device verified status display remains open.

**Windows Codex Bridge unrelated blocker:** `codex_home_permissions` was a POSIX mode check incorrectly applied to Windows. Fixed by owner SID-only explicit NTFS ACL via `icacls`; Windows test PASS; installed Windows `codex-home` ACL inheritance is protected. Actual installed bridge probe now reports `codex_binary_missing`: the Windows Codex app-server executable is **not present**; it remains an independent OPEN gate, not solved by ACL alone. Codex remains optional; Long Memory E2EE Sync worked independently.

**Open gates:** Follow Project mode *real* Windows/Linux scoped bound/unbound E2E, Replica→Home signed evidence and unique scope-authority reconciliation, offline/reconnection conflict and stale restore tests, true per-device revision summary on Wall, and Windows Codex binary packaging/discovery. No claim that the whole G3–G6 roadmap is complete. Keep Account PostgreSQL metadata separate from SQLite private Memory, and preserve the unchanged Gold UI/admin surfaces.

## G3 Replica → Home typed evidence protocol (development handoff)

- `device-agent/gold-memory-evidence.mjs` now implements a local-first, bounded,
  per-scope Replica contribution protocol. An enrolled Replica with an active
  signed Home grant creates a typed event (`test_receipt`, `fs_change`,
  `task_state_changed`, `operator_receipt`, or `manual_note`). The event
  is signed using its own Ed25519 device key and encrypted for the scope Home
  with ephemeral X25519/HKDF/AES-256-GCM; the relay never sees the body.
- The Replica stores ciphertext in `lm_evidence_outbox` SQLite before
  transport. The Operator's `memory-relay` has volatile `push_evidence`,
  `pull_evidence`, `push_evidence_ack`, and `pull_evidence_acks` actions,
  with enrolled account membership and selected-device authorization. No
  event body, decrypted payload, SQLite, or secret is in PG/Redis/cloud logs.
- The Home checks account, exact scope authority, Home epoch, grant ID,
  non-revoked Replica member and Ed25519 signature, decrypts the event, and
  commits the provenance-tagged checkpoint and idempotency receipt in ONE
  SQLite transaction. The Home's signed ACK carries its newly authoritative
  checkpoint/revision back to the Replica. Retries do not double-commit.
- The Gold Agent relay worker polls inbound events/ACKs and drains the
  Replica's bounded persistent outbox, with account per-device policy checks.
  Replica Manual *event contribution* is deliberately deferred: manual
  mode never silently drains the evidence queue. Ordinary Manual
  Home→Replica checkpoints remain implemented and E2E PASS.
- Unit/regression receipt:
  `GOLD_REPLICA_TO_HOME_E2EE_SIGNED_TYPED_EVENT_ATOMIC_COMMIT_REPLAY_RESTART_REVOCATION_PASS`;
  also checks relay envelope, account isolation, duplicate ACK, revoke,
  outbox persistence across restart, and Home→Replica round-trip of the new
  Home-signed checkpoint. Canonical Windows core manifest now contains
  **102 files** (was 101) including `gold-memory-evidence.mjs`.
- **Not yet a feature-complete claim:** automatic selection of which
  Replica-local operator/PTY/codex events to contribute requires a typed
  source adapter and owner-scoped provenance filter; Home↔Windows real
  event ingestion, offline/reconnect, manual-source trigger, source-side
  Follow Project binding proof propagation and full scope manifest
  reconciliation remain independent acceptance gates. Use only synthetic
  authorized UAT event for live test.
