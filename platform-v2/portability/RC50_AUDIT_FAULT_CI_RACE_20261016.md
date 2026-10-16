# rc.50 — CI audit fault injection race diagnosis and test correction

Date: 2026-10-16 Asia/Ho_Chi_Minh
Baseline: 7cd49b401192da0a54c735fb39074901e08dd2e2
CI failed run: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/38851495298

## What failed

- Native ARM64 source/runtime job SUCCESS and native x64 source/runtime job SUCCESS.
- `isolated-data-contract` failed in existing `platform-v2/test/operator-audit-failure-runtime.test.mjs` at the first request's assertion: expected HTTP 400 but observed HTTP 503. Full suite result 65 PASS / 1 FAIL.
- Subsequent CI teardown tried `docker compose down` despite disposable database credentials never having been generated because the regression step failed before DB setup. Compose reported missing `platform-v2/secrets/postgres.env`, a misleading secondary cleanup failure.

## Actual race and narrowly changed tests/CI workflow

In this UAT, a disposable Operator child is first observed OPEN. The test then replaces its private audit log path with an EISDIR directory, intentionally causing the next append/fsync to fail. Under the heavily parallel CI suite, a still-queued **bootstrap audit append** can hit that injected fault before the request to `/v1/plugin/sessions?accountId=` is admitted. In that order the real Operator correctly freezes and returns HTTP 503 `local_ingress_frozen` instead of first returning HTTP 400 `invalid_account_id`.

We now accept ONLY either:
- 400 **with** `invalid_account_id`, when invalid request reaches the handler before the audit failure, or
- 503 **with** `local_ingress_frozen`, when the audit failure first seals admission.

All substantial security assertions remain mandatory in either ordering: durable 0600 marker, `phase=freezing`, `sealFailed=true`, `drained=false`, HTTP new work 503, `/readyz` 503 and `/healthz` diagnostic 200, and the actual `[disk] append failed` record. We did **not** disable the EISDIR fault, skip test, change production Operator or weaken the negative gate.

The isolated CI cleanup now checks whether *both* CI-created credentials exist before running `docker compose down`; if missing, the Compose database was never launched in this ordered job. The error from regression remains the primary failure rather than being obscured by missing env in cleanup. Native ARM64 cleanup is unchanged.

## Validation

VPS-ARM isolated focused runtime fault test PASS; complete feature Node regression **66/66 PASS**; P0 release negatives PASS; source writer guards PASS; `git diff --check` PASS. Native CI for the NEW fix commit must be checked separately for all three jobs before recording accepted CI.

## Gate and scope

All five P0 release gates remain NOT_READY, in particular remote Agent side effects, global epoch, 16/18 registry fsync, full sealed cross-host restore. Production unchanged; no customer data or real Agent approvals involved.
