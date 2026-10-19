# Gold real PostgreSQL Job Ledger UAT — 2026-10-19

Branch: `feature/light-remote-gold-rebuild-20261018`.
Target: isolated VPS-ARM LXD `light-remote-gold-uat`, Gold PostgreSQL 17, Redis 8, Operator and Plugin. Production unchanged.

## Actual PostgreSQL observations

- SQL table `lr_gold_job_records` empty before test (`GOLD_JOB_REAL_PG17_PREFLIGHT=PASS`).
- Wrote one synthetic job metadata entry using canonical `GoldJobLedger.save()` and flushed its PostgreSQL write. Account and device references were read from the existing synthetic Gold UAT Account/Device.
- `running` state was verified from typed PostgreSQL columns and `public_view` immediately after write (`GOLD_JOB_REAL_PG17_RUNNING_AND_REDACTED=PASS`).
- A synthetic sensitive marker was present only in test code's `script`, `note` and `resultSummary`; the persisted view did not include the raw marker. Note and summary were redacted. Job script bytes were never written to SQL.
- Restarted actual Gold Operator and Plugin; both returned active.
- Gold Operator startup `GoldJobLedger.open()` transitioned the pre-restart job to `interrupted`; the read-stage UAT verified the typed status and the JSON public view, via `GoldJobLedger.get()` (`GOLD_JOB_REAL_PG17_AFTER_OPERATOR_RESTART=PASS`).
- Removed only the known synthetic job ID with a guarded query, verified table returned to zero rows (`GOLD_JOB_REAL_PG17_CLEANUP=PASS`, final preflight PASS).
- Post-test Gold Operator, Plugin, PostgreSQL and Redis remain active.

Script: `deploy/scripts/uat-gold-job-ledger.mjs`. Explicit stage `GOLD_JOB_UAT_STAGE=preflight|write|read|cleanup`, instance guard `LR_GOLD_INSTANCE_ID=uat19`, refuses write/cleanup if unexpected records exist.

## Acceptance boundary

This proves canonical **PostgreSQL job metadata persistence, startup interruption recovery and redaction** on real Gold LXD. It does **not** prove the end-to-end Job HTTP API, Fleet command dispatch, real device execution, terminal streams, or multi-device concurrency. Do not mark those as tested.

### Other open blockers remain

- Signed Paddle HTTP webhook grant/replay/restart previously passed with synthetic HMAC and no external Paddle API calls. Subsequent signed cancel/cleanup was blocked by tool safety: **the isolated UAT synthetic account still has Pro entitlement, one signed event and one subscription**. This was verified read-only again on 2026-10-19. Do not expose or promote UAT while this test state remains.
- Pro Team full HTTP, License issuance/redeem HTTP, enrollment A/B, Fleet/Job execution, support delivery, OAuth and full public demo acceptance still outstanding.
- Gold Plugin is loopback-bound inside LXD. No verified independent HTTPS public Gold endpoint or DNS record exists.

Production `light-remote-direct` was not changed and the previous safety denial was not bypassed.
