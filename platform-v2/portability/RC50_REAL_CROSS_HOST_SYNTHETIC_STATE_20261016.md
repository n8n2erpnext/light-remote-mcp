# RC50 P0-D — independent physical ARM64→x64 synthetic state archive / restore / rollback UAT

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline: `7a1c4188e3ade8436419a60fa57ea5ce4ab11395`
Feature branch: `feature/rc50-mjs-scale-20261011`
Risk classification: **synthetic-only, source/target never activated as writers**.
Status: cross-host transport+SHA, restore, rollback **SUBSET PASS**. P0-D and all other P0 gates remain **NOT_READY**.

## Why this is different from earlier single-host Compose rehearsal

The older `rehearse_cold_move_uat.py` exercises private PostgreSQL/Redis using two Docker Compose stacks **on the same host**. This turn exercised a real archive moving between physically separate, authorized machines using the official Light Remote channel:
- **Source VPS-ARM**: hostname `VPS-ARM`, Linux `aarch64`, no real Operator/Plugin/Agent state read.
- **Destination HOMELAB**: hostname `HOMELAB`, Linux `x86_64`, user `thaiduy`, no Node in PATH required, only Python. No existing Docker volumes/containers, PG/Redis services, firewall or host services touched.
- Scratch-only destination parent `/home/thaiduy/rc50-portability-uat` (mode 0700). Scratch roots must be freshly created with `lr_rc50_crosshost_<12hex>` names and `rc50-synthetic-only-v1` marker.

## Exact observed end-to-end result

New `platform-v2/portability/cross_host_synthetic_state_uat.py` (stdlib Python):
- `source --root ... --confirm-synthetic-only` creates 13 small invented JSON fixture state planes in 0600 files (Operator accounts/devices/sessions/revoked A/B grants/remote effects/jobs, Plugin consumed OAuth hash/Paddle events/support outbox, Wall trust references with no real private key, **FAKE JSON REPRESENTATIONS** of PG and Redis, and Agent effect inventory).
- Emits synthetic local freeze description and closed manifest with per-file SHA-256, fixture ID, declared source hostname/arch, SHA freeze digest and `globalWriterFenceProven:false`, `cutoverAuthorized:false`. These attributes are **claims of a test fixture, NOT authenticated source writer fencing**.
- Explicit allowlisted ZIP, no unknown/duplicate/traversal entries, bounded payload sizes, strict structure and hash verification.
- `restore --root ... --archive ... --confirm-synthetic-only` requires the source hostname differ from destination; verifies before restore, writes exact files into a hidden 0700 stage with 0600 data and fsync, writes a permanent activation-denied marker, then atomically publishes `restored-state` and fsyncs parent. Does NOT start any writer.
- `activate` is intentionally **always DENIED** with `authenticated_old_writer_fence_absent` independent of any synthetic success.
- `rollback` is safe/quarantine-only: checks immutable deny-state semantic content, atomically renames `restored-state` to `rolled-back-restored-state`, fsyncs parent, writes marker. No reactivation/source writes, no deletion of user state.

Concrete user-authorized machines UAT:
1. Generated archive on VPS-ARM at `/home/ubuntu/lr_rc50_crosshost_abcabcdef123/rc50-frozen-synthetic-state.zip`.
2. Total ZIP bytes **4190**, fixture ID `1a379841af37`, 13 state files. Exact SHA-256 `a5e878257847844c3393b5eb2cc98191fef2a6685f37ad1225f208fb871d54c8`.
3. Started official Light SCP download successfully and began upload to HOMELAB. **Light SCP upload chunk returned `scp_invalid_sha256` (HTTP 400)**, and an attempted ordinary Base64 representation returned `scp_invalid_chunk_encoding`. Upload was **explicitly canceled** (no file committed). Do not claim SCP succeeded; it is an independently tracked transport defect.
4. For this synthetic fixture ONLY, wrote a Base64URL text transport representation on VPS-ARM, used the already-authorized Light Remote text read/write workflow to move it to HOMELAB, locally decoded it. Target independently computed the SAME SHA-256. This is an alternate file transport method, not a forbidden policy bypass; no denied file/write permission was circumvented.
5. HOMELAB `verify` reported `crossHost:true`, source architecture `aarch64`, destination `x86_64`, 13 files and same SHA. Independently compared **13/13 restored file SHA bytes** against archive and all matched.
6. HOMELAB `restore` to `/home/thaiduy/rc50-portability-uat/lr_rc50_crosshost_ffeeddccbbaa` PASS; activation request refused with `authenticated_old_writer_fence_absent`.
7. HOMELAB `rollback` PASS, quarantined exact restored fixtures instead of deleting. Re-deployed updated Python script (same SHA as repo file), repeated full staged-atomic `restore → rollback` at `.../lr_rc50_crosshost_cafebabedead`: **PASS**, no hidden partial stage and `activation-denied.json` present before commit.
8. The two completed target archives are quarantined scratch evidence; none of the target operations enabled a writer. Source fixture was never a live writer.

## Negative tests

`platform-v2/test/test_cross_host_synthetic_state_uat.py` uses only ephemeral scratch dirs and tests:
- Archive manifest and SHA integrity; no false global fencing claim.
- Same-host restore denied.
- Private staged restore and quarantine rollback only; not a writer.
- Payload hash corruption denied.
- Fake/mismatched freeze descriptor denied.
- Archive with path traversal/extra ZIP entry denied.
- Unsafe scratch root / absent synthetic-only marker denied.
- Altered activation-denied marker causes rollback refusal.

Eight Python tests **8/8 PASS** on VPS-ARM. These are also added explicitly to the existing GitHub Actions isolated-data-contract and native Linux ARM64/x64 jobs. Native CI statuses must be confirmed by exact SHA; do not infer CI pass from local UAT.

## What remains missing (P0-D NOT_READY)

- **No actual Operator/Plugin legacy JSON registries were copied**, no authentic PG `pg_dump` or Redis RDB across machines, no customer data.
- No global owner-issued authenticated WriterEpoch, old-writer fencing across Operator/Plugin/Fleet/Agent, complete durable remote effects, outbox/watermark, OAuth replay, Paddle billable provider events.
- No tenant identity/signing-key custody attestation, signed source freeze certificate, or authenticated source origin; SHA-256 only proves same bytes from this test, NOT trusted origin/approval.
- No Agent binary cross-host continuity, network/device reconnection or billing/RM/PTY/SCP product E2E.
- No real target activation or old host failover; the rollback was a **write-disabled quarantine**, not rollback of activated production state.
- Active WriterEpoch authorization is deliberately unavailable and `activate` fails closed. An archive that restores successfully does not earn permission to lift this restriction.

All five P0 release gates A/B/C/D/E remain NOT_READY; 16/18 source writer fsync-proven, no global single-writer authority. Do not merge to main or deploy production on this evidence.
