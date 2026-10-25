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
