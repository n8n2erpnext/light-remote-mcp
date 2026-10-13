# rc50 P0 — Real Operator + Plugin JSON writer durability: 16/18

**Date:** 2026-10-13, Asia/Ho_Chi_Minh. **Target:** VPS-ARM authorized Light Remote, feature/rc50-mjs-scale-20261011. **Base SHA:** d574c1ab7771b3a7297c10902469e0d246f4391f. This is actual dev-source refactoring, NOT an operational cutover or customer-data migration.

## What changed in actual production-path source on isolated feature branch

Prior commit d574c1a wired durableAtomicWriteSync into five writer inventory surfaces (device state, enrollment, enrollment signer, host identity, host companion). This commit wires **eleven more** independent writer surfaces to the *same tested* atomic-file helper:

Operator:
- ACCESS_STATE_FILE — operator-host/device-access-grant-registry.mjs
- AGENT_CLIENT_STATE_FILE — operator-host/agent-client-registry.mjs
- USAGE_STATE_FILE — operator-host/usage-registry.mjs
- FREE_BENEFIT_STATE_FILE — operator-host/free-benefit-registry.mjs
- PRO_TEAM_STATE_FILE — operator-host/pro-team-registry.mjs
- NOTIFICATION_STATE_FILE — operator-host/account-notification-registry.mjs
- LICENSE_STATE_FILE — operator-host/license-key-registry.mjs

Plugin:
- PLUGIN_GOOGLE_OAUTH — plugin-server/google-auth.mjs
- PLUGIN_PADDLE_BILLING — plugin-server/paddle-billing.mjs
- PLUGIN_SITE_CONTENT — plugin-server/site-announcements.mjs (preserves 0640 file mode)
- PLUGIN_SUPPORT_OUTBOX — plugin-server/support-backoffice.mjs

This replaces old `writeFileSync(tmp) → chmodSync(tmp) → renameSync(tmp,dest)` sequences with the already tested `durableAtomicWriteSync(dest,payload,{mode})`. It preserves the serialized schema and runs synchronously, finishing file fsync, atomic rename and parent-dir fsync before returning. A persistent error latches future writes within the process. It does NOT itself serialize writers between processes or make a multi-file transaction.

## Verification

- All 11 modified modules individually passed `node --check`.
- New `platform-v2/test/test-durable-registry-wave2.mjs`: two Node tests executed using disposable temporary paths and fake data. Exercises real constructor/persist/reload for usage, account notifications, Free benefit, Pro Team, license, agent client, device access grant and support outbox. Separate Node processes exercise site announcements writer/read back with temp `LIGHT_REMOTE_SITE_CONTENT_PATH`; mode 0640 checked. No real service or network communication. **2/2 PASS**.
- `node --test platform-v2/test/*.test.mjs` **34/34 PASS**, after updating `platform-v2/scripts/scale-static-audit.mjs` historical markers for usage, Paddle and Team to the new durable helper. The audit still flags synchronous full JSON snapshots, global writer concurrency, bounded Paddle event replay and volatile OAuth/job state; P0 architectural risk was NOT removed.
- `python3 -B platform-v2/test/test_writer_freeze_readiness.py` **11/11 PASS**, including rejection of false global fence/readiness claims.
- `python3 -B platform-v2/portability/audit_writer_freeze_readiness.py` reports `fsync_proven=16`, `fsync_not_proven=2`, `single_writer_authority_proven=false`, **status=NOT_READY**.
- Existing shared-helper fault injection from previous commit: `platform-v2/test/test-durable-atomic-file.mjs` **7/7 PASS**; no new code changed inside helper.
- `git diff --check` PASS.

## Remaining 2/18 durability inventory blockers (NOT edited)
1. CONNECTION_STATE_FILE — `operator-host/device-connection-registry.mjs`. Structured edit was tool-safety BLOCKED in previous turn; do NOT retry through shell/PTY/alternate connector to bypass.
2. ACCOUNT_STATE_FILE — `operator-host/account-registry.mjs`. This turn's structured edit of persistence was tool-safety BLOCKED; a prior import-only partial change was reverted with `git restore -- operator-host/account-registry.mjs`; do NOT bypass using other tool. Both files remain clean relative to prior Git HEAD.

## P0 acceptance remains open even after 16/18

- Per-file fsync is not proof of consistent **multi-file** checkpoint or one authoritative writer. There is no epoch + revoke guard applied at every Operator/Plugin/Fleet/PTY mutation boundary. The audit intentionally reports NOT_READY.
- A live process may already mutate in-memory registry state before an I/O error. Sticky error latches future writes but is not full transaction rollback for in-memory maps. Runtime failure semantics still need guarded state transitions.
- Google OAuth, Paddle/ERPNext, support outbox, usage and Free benefit are still written as independent JSON snapshots. Cross-process lost-update hazards and billing dedupe history length are not solved by atomic rename.
- Production-equivalent OAuth → Local Wall A/B → real device origin and key custody, independently authenticated verifier stage SCRAM/mTLS, actual grant/Agent authority are not proven. The prior signed Ed25519+PG receipt integration was a scratch synthetic UAT.
- Cross-host ARM→AMD consistent fake multi-service state/keys/PG/Redis/JSON restore and exactly-one-writer handoff with rollback NOT proven. The earlier persistent HTTP Docker runner integration was tool-blocked and not bypassed.
- No production device commands, real customer files/keys, main merge, production Docker restart, DNS, billing/ERPNext/Paddle API interactions or live Agent PTY/RM/SCP were performed.

**Next P0 priority:** finish gate A/C via a shared writer ingress/freeze boundary and quiesce/drain acceptance in isolated dev. Handle the two explicitly blocked writer source paths only through a permitted path, without alternate-tool circumvention. Then harden authenticated origin and cross-host restore. Read [RC50_P0_CLOSEOUT_GATES_20261013.md](./RC50_P0_CLOSEOUT_GATES_20261013.md) for the finite acceptance checklist. Node ESM .mjs + Express5 remains canonical.
