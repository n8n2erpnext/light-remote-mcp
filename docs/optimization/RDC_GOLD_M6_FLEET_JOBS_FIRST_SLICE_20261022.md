# Gold M plan — M6 Fleet Wall Jobs & Queue first slice (2026-10-22)

## Owner scope change — authoritative

Owner paused physical multi-Agent Pro 3+1 and Pro Team UAT until more real devices and human participants are available. **Do not continue automated 3+1/Team tests, demand new A/B codes, or promote cross-account Team execution.** Keep signed OAuth A/B and real PostgreSQL evidence as the accepted checkpoint, not completed throughput acceptance.

Known M3 personal physical checkpoint: four authentic Gold OAuth clients A/B/C/D owner-approved, after source/runtime patch b99cd64 all four were READY; three-running + fourth-queued physical acceptance is STILL PENDING, as is separate Linux target A/B for clients. Pro Team M3-T remains OFF. Installed Gold Operator/Plugin runtime was not upgraded for this new M6 source-only slice. Production, billing and owner-installed Windows/macOS clients untouched.

## Temporary UAT cleanup

- Stopped the user-approved temporary ARM NetBird-to-LXD Wall bridge managed process lp_1pa7ODAWIt9S4wGz7TWu00mJ using structured stop; **verified the bound temporary VPN port 55491 returns ECONNREFUSED**.
- Did **not** revoke previous owner A/B grants, reset Gold UAT database, close owner's unrelated sessions, remove agent devices or forcibly kill an OS process to evade policy.
- The old Windows localhost harness and any stale Gold resource claim require separate ordinary lifecycle reconciliation before new physical testing, not fabricated scheduler receipts.

## M6 implementation scope (source + CI only)

- Added Fleet Wall `/jobs` read-only management overview and `/api/jobs?limit=1..200`.
- Extended canonical `GoldJobLedger` with bounded, parameterized `listForOwner` over PostgreSQL `lr_gold_job_records` joined to `lr_gold_personal_agent_work` for true queued reason; SQL filters owner account ID and authorized enrolled devices, not UI-supplied identifiers. Live in-memory jobs override their matching durable snapshots, historical/after-restart rows persist and `interrupted` remains untrusted outcome. Existing snapshots without role metadata are rendered `unclassified`, never misrepresented as finished downloads; unknown output bytes show `not retained`.
- Fleet component packaged independently from desktop Client: added `fleet-job-page.mjs` to signed fleet-wall module build, component release validation and signed module fixture. This source must NOT depend on being present in `client/core-files.json` (Core Client packages a component manager, not the Fleet Wall module runtime).
- Signed main-device Fleet transport `fleet-jobs` is **observer** mode and assigned the existing `fleet` rate lane. Requires normal signed channel verification **and** live verified Fleet authority. Jobs are narrowed to the main-device owner's account AND currently enrolled/nonrevoked devices.
- `ownerFleetJobRows()` returns only job ID, device, signed Agent/session IDs, status, queue reason, work class, timestamps, exit status, output byte count and role. **No raw command/script/output, environment, resultData, access tokens or another account's jobs.** A foreground `process_launch` completion must not be presented as a completed detached process.
- Browser `/jobs` filters current retained Operator job records, auto-refreshes only while visible, uses textContent (no untrusted HTML injection), and points users back to owner Local Wall for actual stop/force-stop. This slice deliberately does **not** add arbitrary Fleet cancellation or alter running Agent policies.
- Main Fleet Wall homepage now links Jobs & Queue. No changes to production or payment/Team routes.

## Verification and remaining M gates

- `node --check` on touched JS modules: PASS.
- `selftest-gold-fleet-jobs-m6.mjs`: account/device scope, safe projection and read-only page assertions PASS.
- `git diff --check`: PASS.
- CI Gold Operator workflow runs these tests on the feature branch after push. Treat CI as pending until actual result arrives.
- **NOT physically accepted:** authenticated browser Fleet Wall display, end-to-end PG history UI after actual Operator restart, owner cancel across devices with full scope/CSRF/revocation audit, signed per-device resource metrics, cross-OS concurrency and full Team 5-seat UAT. Do not present M6 as finished or Team as enabled.
- Next implementation steps while owner prepares resources: M6 durable PostgreSQL history/pagination and owner-scoped per-device safe cancellation (strong proof before worker release), then M4/M5 stale process lease reconciliation, platform parity in CI. Leave 3+1 and Team tests parked pending real users/devices.

Source: `feature/light-remote-gold-rebuild-20261018`. Rollback: revert this source commit; no schema migrations or deployed unit changes for M6.
