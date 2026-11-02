# GoldABV2 Lab — Long Memory read-only audit — 2026-11-02

**Conclusion:** Long Memory module ON, SQLite structurally OK and source selftests 17/17 PASS. EXISTING LOCAL MEMORY HOME DATA IS BOUND TO A HISTORICAL ACCOUNT/DEVICE, NOT THE CURRENT GOLDABV2 ENROLLMENT. Fail-closed behavior must remain; NOT ready for live cross-device Memory sync under current account.

## Scope and safety

- Target ONLY VPS-ARM LXD light-remote-abv2-lab-20261101. Current Wall R5 live source /opt/light-remote-abv2-lab/source-61b18b8b-wall-r5-STAGED, four services active.
- No Owner login, A/B grant, Long Memory configuration, account/device identity, encryption/signing keys, SQLite rows, scope data or replica state changed.
- All database inspection used SQLite URI mode=ro under gold-uat. Source selftests used isolated temporary databases (not the live Memory DB).
- No live memory write/sync/deletion/Account Delete performed or claimed; live E2E blocked pending validated Memory Home identity. Preserve data.

## Runtime module / data inventory

- Agent effective state file is /var/lib/light-remote-gold-uat/wall/device.json **inside isolated Lab LXD**. Module file (derived from OPERATOR_AGENT_STATE) /var/lib/light-remote-gold-uat/wall/gold-wall-modules.sqlite (0600 gold-uat). Directory path name says gold-uat but container boundary is isolated: do NOT operate the main Gold UAT host using this path.
- module_flags: longMemory=true, codexBridge=true, revision=6.
- SQLite quick_check=ok; 3 active lm_scopes; 12 lm_checkpoint_v2 records; 3 lm_heads with matching revision distribution [1,5,6]; 3 legacy gold_checkpoints; 2 lm_work_bindings; 6 active replica member rows covering 2 distinct devices.
- lm_sync_outbox has 24 rows, ALL state=acked, 0 pending; 0 inbox; 0 peer routes; 0 quarantine; 0 local-scope tombstones.
- Historical ACK interval 2026-10-25 06:10:02 UTC through 2026-10-29 13:20:24 UTC. A historical ACK is NOT evidence of current enrollment or active replica synchronization.
- Key files checkpoint-key, device-ed25519-key, device-x25519-key all present mode 0600; DB mode 0600.
- Device Sync selection enabled=true, selected device count=1, receive_blocked=false, BUT bound to old identity.

## CRITICAL identity mismatch

Compare only booleans (do not print raw historic/current Account ID or Device ID, signed payloads or Memory data):
- All 3 existing scopes have old Account ID != current enrollment Account ID.
- All 3 scopes have old home_device_id != current enrollment Device ID.
- lm_sync_device_selection Account ID and Home ID match the OLD scopes and each other; both mismatch current enrollment.
- Current enrolled device is NOT among existing lm_scope_members. Current enrolled Account ID has ZERO scopes in the existing DB.
- The 3 scopes share one historical Account ID and one historical Home Device ID. This is a coherent OLD identity, not random corruption.
- In device-agent/operator-agent.mjs GOLD_WALL_MODULES uses the current readState().enrollment accountId/deviceId for scopeIdentity.
- device-agent/gold-wall-modules.mjs listMemoryScopes passes current accountId; device-agent/gold-memory-scope.mjs listGoldScopes filters WHERE s.account_id=? AND s.status='active'. Therefore an apparently empty My Work list is EXPECTED under the current enrollment even though historical scoped records remain on disk.
- Possible cause is an enrollment/Owner transfer or identity reset, but NOT proven by this audit. Do not assume old scopes can legally/cryptographically belong to the new Owner without signed authority.

## Source regressions — 17/17 PASS, safe temporary DB

- selftest-gold-memory-plugin.mjs
- selftest-gold-memory-cli-scoped.mjs
- selftest-gold-memory-scope-v2.mjs
- selftest-gold-memory-scope-management.mjs
- selftest-gold-memory-simple-sync.mjs
- selftest-gold-memory-device-modes.mjs
- selftest-gold-memory-sync-v3.mjs
- selftest-gold-memory-peer-v3.mjs
- selftest-gold-memory-rendezvous.mjs
- selftest-gold-memory-replica-evidence.mjs
- selftest-gold-memory-account-relay.mjs
- selftest-gold-memory-account-directory.mjs
- selftest-gold-memory-auto-v2.mjs
- selftest-gold-memory-reader-export.mjs
- selftest-gold-memory-account-ui.mjs
- selftest-gold-memory-account-delete.mjs
- selftest-gold-memory-delete-settings.mjs

These validate implementation on synthetic data, not live old->new signed Memory Home migration.

## Error telemetry (non-secret)

- Historical Wall journal contains repeated gold_memory_relay_tick_failed, gold_sync_peer_tick_failed, gold_memory_directory_refresh_failed and a memory_account_sync_revision_conflict. Filtered sample of relay failure contained code 'fetch failed'; network/cloud status requires further observation.
- No memory-specific errors observed in Wall journal after 2026-11-02 20:00 during this audit. No claim of successful live relay.
- Cloud displayed dormant in user screenshot prior to audit. Independent cloud availability should be tested once Owner intentionally connects, not by changing private credentials or initiating unauthorized network operations.

## Outstanding acceptance gates / safe remediation sequence

1. Owner confirms intended Memory Home device/account and whether preserving old Owner scopes is authorized. Re-verify that current enrollment identity is correct and whether previous identity was an approved owner transfer.
2. Before any migration: take restricted backup of local SQLite + WAL, signing/encryption keys, signed history and current enrollment metadata; record hashes and obtain Owner approval. Never copy sensitive payloads into chat/handoff/Git.
3. On an isolated CLONE, design and verify explicit signed ownership-transfer/re-home or import that preserves old immutable evidence and lets new Home use freshly authorized signing identity. Never SQL UPDATE account_id/home_device_id blindly, never replace device.json to match old account, never disable binding checks.
4. Validate old history signatures, revision chain, head/hash continuity, workspace bindings, scope visibility under new Owner, recipient replica permissions, and zero cross-account leakage.
5. Only after Owner-approved signed migration, test true cross-device account Relay/selected-device sync and recovery; compare ACK and receipt timestamps with current date. Run negatives for wrong Owner, wrong Device and stale attempt.
6. Consider showing a UI warning such as 'Saved scopes belong to a previous enrollment; verify Memory Home' instead of silently empty My Work. This needs an explicit reviewed info-only endpoint and must not reveal historic account details.
7. Keep current fail-closed operation and NO production/main Gold UAT deployment until audited and accepted.

## Exact source map

- device-agent/operator-agent.mjs: STATE_FILE and scopeIdentity from current enrollment.
- device-agent/gold-wall-modules.mjs: SQLite flags, encryption/signing keys, listMemoryScopes/current Account filter, syncIdentity/deviceSyncSelection.
- device-agent/gold-memory-scope.mjs: account-scoped list and device_home authorization.
- device-agent/gold-memory-sync.mjs, gold-memory-peer.mjs, gold-memory-device-selection.mjs: signed cross-device scope/frame/selection.
- operator-host/gold-memory-account-sync-policy.mjs, gold-memory-rendezvous.mjs: account relay policies.
- plugin-server/gold-memory-bridge.mjs: restricted authorized Agent operations; does NOT waive grant.
- deploy/scripts/selftest-gold-memory-*.mjs: isolated fixtures and independent tests.

**END. Long Memory feature implemented but live current enrollment is NOT yet bound to historical Memory Home.**
