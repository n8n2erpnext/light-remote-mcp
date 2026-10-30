# Gold P2 — single acceptance ledger for AB V2, nickname, Pro Share and P2
Owner-requested unified implementation train, 2026-10-30.
Plan: `docs/gold/GOLD_P2_INTEGRATED_ABV2_NICKNAME_PRO_SHARE_PLAN_20261030.md`

## Evidence states
`REUSED_SOURCE_PASS` = previous isolated tests/CI established for corresponding source commit, not live acceptance.
`NEEDS_IMPLEMENTATION` = no accepted feature path yet.
`READY_FOR_PHYSICAL` = all automated prerequisites pass on a frozen integrated release commit.
`PHYSICAL_PASS` = verified real clients/device/browser/end-to-end on SAME release commit and signed artifacts.
`HOLD` = production promotion forbidden. New changes after a PASS invalidate only affected evidence plus shared auth/session/claims cross-feature smoke.

| ID | Test area | Current evidence | Frozen integrated target |
| --- | --- | --- | --- |
| C01 | PG039->042 isolated four-unit success/failure/rollback | REUSED_SOURCE_PASS at ad64059 | Add new migrations, repeat paired rollback ONCE at frozen SHA |
| C02 | Ed25519 epoch, inventory, exact terminal ACK, no-PID fence | REUSED_SOURCE_PASS at d6892d7; fixture only | Live authorized Agent signed receipt and no fabricated ACK |
| C03 | Two Operators, 1,000/10,000 synthetic devices | REUSED_SOURCE_PASS, baseline Git CI 41025222358 | CI at integrated SHA, expanded pairing nickname/guest concurrency |
| A01 | Owner/account-scoped stable 6-char device short IDs | **PARTIAL_SOURCE_PASS** — PG043 candidate + ID allocator/owner-scoped resolver pass isolated tests; not wired to Wall/Operator, not in migration manifest | **Prefix always visible** in authorized Wall STANDBY + `/account` list, stable across restart/idle/offline; no rotating suffix until request; backfill/reboot/collision/old devices, non-recycled |
| A02 | Bounded resolver 0/1/N, duplicate hostname, 100 devices | **PARTIAL_SOURCE_PASS** — OAuth HMAC owner/device/Agent-scoped Helper targetQuery 0/1/N and duplicate-name fixtures PASS; PG043 still candidate, real installed OAuth E2E not done | Only permitted metadata; no automatic Main or issue on ambiguous |
| A03 | On-demand 6+5 A, independent B, atomic single-use/TTL | **PARTIAL_ISOLATED_PASS** — real Redis8 no-NIC clone atomic issue/Refresh/B/replay/grant_receipt/grant_commit PASS; signed Helper request issuance and internal durable-grant coordinator source-wired OFF; V2 owner approval and Helper ready NOT mounted | **V2 pending approval expires at 300 seconds from server creation** (V1 still 180 seconds); A suffix and B share deadline; no polling/reload extension, no late approvals, attempts rate-limited; multi-tab/multi-Agent, wrong B/expired/revoked/device change denied |
| A04 | Local Wall standby/approve + account portal approval | **PARTIAL_SOURCE_PASS** — Redis scoped pending index, server-side /account owner proxy/hidden preview, signed Agent→Operator→Local Wall read-only pending preview, source HTTP/local Wall fixtures PASS; V2 owner B approval, Local Wall Refresh/Deny, Short ID STANDBY, installed OAuth/Agent E2E NOT implemented | Wall STANDBY has permanent Short ID, Refresh status, Copy ID and explicitly selected legacy V1 manual pairing recovery; pending V2 has selected-request Refresh that atomically rotates A suffix + B, generation and new 300s deadline; Agent receives new B on exact authorized helper poll; old B denied, CSRF and rate limits; offline does not mint local codes; approval remains explicit |
| A05 | Legacy 4+4 A/B backwards compat, 24h lease | REUSED_SOURCE_PASS for legacy only | Old/new client and device policy/capacity on same SHA |
| A08 | Verified B → per-Agent durable 24h grant; no access before PostgreSQL commit | **PARTIAL_ISOLATED_PASS** — Redis8 grant receipt/commit and real GoldNativeAB + GoldRegistryPersistence flush/readback/restart on **disposable no-NIC PG database** PASS; pre-durable grant exposure reproduced then fixed with quarantined two-phase activation; no full-schema FK/installed Agent E2E or owner route yet | Full-schema 039→043 clone rehearsal, atomic B verification and crash/restart at every seam, two-phase PG staged+active snapshots, no grant before durability, independent Agent timers, signed native OAuth/Wall approval and Helper ready |
| A06 | Future IT Support extension seam: organization, branch, device cluster, assigned user and group | FUTURE_NON_BLOCKING — after core Light Remote stabilizes; no P2 acceptance requirement | Two synthetic orgs/branches, overlapping device clusters and groups: scoped discovery, no cross-org/device leakage or self-approval; assignment revocation fences jobs; stable Short ID on site/cluster move; Pro Share still exactly shared devices |
| A07 | Owner enterprise example: 1 Leader, 10 branches, 5 Support, 100 devices | FUTURE_NON_BLOCKING — reference scenario, NOT a P2 implementation or test gate | Leader org-scope sees all 100; each Support sees its own 2 branches (~20 devices); move device B01→B03 without Short ID/UUID change: S01 loses 1, S02 gains 1 but inherits no A/B grant; revoked branch/group disallows new requests and fences queued work; unrelated org cannot enumerate; future IT Support UI/RBAC deferred |
| N01 | First automatically Agent-chosen nickname after ready | NEEDS_IMPLEMENTATION; hardcoded label today | No user step, no server fallback, no invented model |
| N02 | Immutable sessionId, persistent name, owner override | NEEDS_IMPLEMENTATION | Hold/reconnect/reboot/GC/guest sessions; cross-Operator race |
| N03 | UI, Unicode/XSS/bidi and cross-owner rename controls | NEEDS_IMPLEMENTATION | Browser + adversarial strings, distinct AI clients |
| S01 | Pro Share 1 owner + 1 guest, 5-seat Team frozen | NEEDS_IMPLEMENTATION; base team code retained | One subscribed owner + Free guest, invite/accept, one shared device |
| S02 | Guest's independent OAuth+A/B, private device isolation | NEEDS_IMPLEMENTATION | Two distinct accounts and unrelated 403; no inheritance |
| S03 | Owner-billed idempotent guest usage, quota fences | NEEDS_IMPLEMENTATION | Owner vs Free ledger, retry/replay, exhausted add-on |
| S04 | Revoke, unshare, pending and in-flight work | NEEDS_IMPLEMENTATION | No resurrected access, no guessed process termination |
| S05 | Pricing/Paddle actual charge activation | HOLD, separate business authorization | Explicit approved tier caps, $5 add-on transaction and cancellation |
| R01 | Full runtime Operator verifiedChannelContext/callback | NEEDS_IMPLEMENTATION/real runtime test | Actual enrolled binding + rate limiter + terminal ACK |
| R02 | Win10/Win11/mac/Linux physical Agent and Wall5491/Fleet5492 | Win10 OFFLINE cryptographic module PASS only | Exact native OS and authorized browser E2E at freeze |
| R03 | Signed installer/updater, rollback, Memory/session preserved | HOLD | Same signed package artifact, bad update/recovery |
| R04 | Fresh backup, restore, owner-approved Gold UAT staged cutover | HOLD, no permission to live change | Four units + PG/Redis, allowlist, healthy readback |
| R05 | Production rc47 archive/cutover | HOLD | Separate owner approval; never during source-only plan |

## Single release manifest per candidate
Create a release-manifest receipt containing:
- Git branch, commit SHA, locked dependency hash, database migration-lock hash and client package hash/signature.
- Exact Gold UAT runtime hash for each four service units and linked wall/client artifact.
- Feature flags and account/device allowlist; old/new A/B compatibility state.
- C/A/N/S/R test IDs with PASS/HOLD, CI run URL, source vs physical evidence, location/date.
- Immutable accepted rollback artifact plus independent PostgreSQL/Redis restore readback.
- Owner sign-off for separate UAT schema change, paid billing, and production cutover.

**Acceptance closure rule:** Do NOT mark a synthetic fixture as a native installed-Agent test; do NOT mark real signed terminal ACK for a historical process merely from a simulated process. For late changed executable code, update artifact hashes, rerun only impacted tests and auth/session cross-smoke, then issue a new frozen release candidate. Avoid a new full certification loop for every incremental feature.

## Immediate I0 checklist (source audit, not rollout)
- [x] Three owner handoffs read against current Gold Git branch (d6892d7 at plan start).
- [x] Found 4+4 Helper legacy, hardcoded session label, teamSessions=null and Team execution disabled.
- [x] Verified existing P2-A/B isolated evidence; Gold UAT live remains PG039 and production rc47 separate.
- [ ] Audit all session mutation persistence hooks / Redis snapshots.
- [ ] Audit source of account-scoped OAuth discovery and exact pending request recovery.
- [ ] Audit durable current team guest principal, owner billing paths and per-device policy gates.
- [ ] Freeze new request/response contracts and additional migration sequence after042.
- [ ] Implement and CI-test A/B V2 then nickname then Pro Share before a physical acceptance freeze.
