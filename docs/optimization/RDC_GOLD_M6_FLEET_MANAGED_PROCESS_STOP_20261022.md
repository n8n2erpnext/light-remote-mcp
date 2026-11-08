# Gold M6 — Fleet Wall managed process graceful Stop (2026-10-22)

## Scope / owner decision

Owner paused physical multi-Agent Pro 3+1 and Pro Team testing until additional legitimate devices and human testers are ready. **Do not resume that testing automatically.** This iteration continues M6 owner Fleet Wall management on `feature/light-remote-gold-rebuild-20261018` from `76597eb`. Work is strictly source + CI, not production or Gold UAT runtime rollout.

## Implementation

- Owner-authenticated, CSRF-validated Fleet Wall `POST /api/jobs/stop` accepts ONLY a `jobId`. No arbitrary OS PID, processId, script, device ID, agent ID, force flag or scope from browser.
- Main Fleet device signs `fleet-process-stop` using normal enrollment key, a current Fleet authority lease, and `control` rate lane. Operator route derives account and enrolled device IDs from verified identity; cross-account, revoked device, invalid signed source denied.
- Operator `requestFleetProcessStop`: accepts only a retained completed success `native-process:start` job marked `managedExec`, whose original account/device/Agent/session are still scoped and present. It fetches matching `worker_state='running'` resource lease and validated `lp_` process ID via parameterized canonical PostgreSQL `lr_gold_device_resource_claims`. Missing/unknown/stale lease => 409, no message sent to device.
- Dispatch uses existing `startProcessOperation()` with `process:{op:'stop',force:false}`, same authorized Agent identity and session as original launch, and freshly generated operation/request IDs. No shortcut socket kill, no bypass of device policy.
- Operator responds HTTP 202, `state=stop_requested`, `terminalVerified=false`. Never advertises successful OS Stop or frees any lease on request acceptance. Only existing signed terminal process receipt path can release claim; a `stopping`/transport-unknown state retains claim. Races on simultaneous Stop requests are serialized in Operator and accepted requests are idempotence-guarded in memory.
- Fleet Wall lists **Request Stop** only for owner-visible managed launch jobs with a matching live Operator object and canonical running PostgreSQL claim. After a request, UI shows `Stop requested · awaiting terminal receipt`. The UI renders `Stopped · signed device receipt verified` only if the signed stop job succeeded with terminal `process.state`, matching the originally requested process ID and positive `finishedAt`, **and** the canonical worker claim no longer exists. Failed/timeout outcomes remain failed/unknown and are directed to Local Wall. Other running jobs and Force Stop remain at the device's authenticated Local Wall. After Operator restart, stop controls on historical jobs fail closed (no original in-memory Agent session).
- No Pro Team, billing, Agent slot, scheduler or database schema changes.

## Evidence

- `node --check` touched Operator/Fleet modules + `git diff --check` PASS.
- `node deploy/scripts/selftest-gold-m6-process-stop.mjs`: owner/lease/session scope, non-running lease rejection, original signed Agent binding, graceful `force:false`, never deleting lease on request, repeated Stop refusal, browser JS+CSRF PASS.
- Prior `selftest-gold-fleet-jobs-m6.mjs` queued-only cancel and durable job projection PASS.
- Gold Operator CI workflow includes new test. Must verify CI result independently before asserting green.

## Remaining gates (not claimed)

- **Gold UAT real physical Stop** of one benign, owner-authorized managed process with signed launch/stop receipt and PostgreSQL worker-claim terminal release is PENDING. No running processes were stopped in this source-only iteration.
- Restart/crash when Stop requested but terminal receipt not delivered, Windows/macOS parity, durable Stop request IDs, and UI report of terminal confirmation are not complete.
- Fleet Wall Force Stop and generalized arbitrary-running-job Stop intentionally not exposed.
- Next M: improve persistent Stop request/terminal receipt display, reconcile stale worker leases using verified signed device inventory, and add per-device resource metrics; then isolated UAT/cutover when sessions may be drained safely. Keep Team/3+1 paused.

Rollback: revert the source commit; no migrations or runtime rollback needed for this iteration.
