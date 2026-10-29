# Gold P0 — Real PostgreSQL38 restart/ledger fixture (2026-10-29)

## Scope
This is a **test-only** addition; the Gold runtime remains d5e7bb0a66bc6ea94175678440b588106a61b859. No production changes and no Windows Agent changes.

## Real DB test
`deploy/scripts/selftest-gold-p0-pg38-restart-ledger-tx.mjs` runs against the isolated Gold UAT PostgreSQL 38 connection from the Operator's current environment, using a randomized fixture and explicit BEGIN/ROLLBACK:
- A persisted `running` job has its public view reconciled to `interrupted` after `GoldJobLedger.open()`, with effect still `unknown`, never a fabricated terminal result.
- A previously committed `cancelled` job retains final status, finish time and exit code 130 through the same simulated restart.
- The PostgreSQL record has a recovery timestamp for interrupted work.
- ROLLBACK leaves zero fixture rows.
- Preflight confirmed no real `running/queued` job-record rows. The three historical background claims stayed on HOLD, not modified.

Observed PASS: `P0_GOLD_REAL_PG38_RESTART_INTERRUPTED_NO_FALSE_TERMINAL_REPLAY_CANCELLED_ROLLBACK_PASS`.

A first attempt failed at the *fixture cleanup query* because the test cast a text job_id column to UUID; corrected test to use `text[]`. The second complete test PASS, including rollback verification. No application defect was inferred from the first test failure.

## Baseline and HOLD
- Gold UAT 4/4 active on d5e7bb0; PostgreSQL claims: running 2, terminal_unknown 1; active personal jobs 0.
- Real Pro Team independent OAuth/A-B multi-device = HOLD_OWNER_RESOURCES.
- Historical claim cleanup = HOLD_EVIDENCE_AND_OWNER_AUTH.
- A/B V2 redesign deferred.
- Windows installed-client E2E signed replay/Stopping remains OPEN and must not be claimed as PASS because isolated fixture tests passed.
