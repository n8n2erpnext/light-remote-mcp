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
