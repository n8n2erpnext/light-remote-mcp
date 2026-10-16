# rc50 P0-B — fail-closed A/B poll precedence for denied and expired requests

**Date:** 2026-10-16 Asia/Ho_Chi_Minh
**Source:** `feature/rc50-mjs-scale-20261011`, baseline `590f1dffa889ef633ae43359b0c18ce259d678d7`
**Scope:** Actual `DeviceAccessGrantRegistry.poll` on feature branch with fake user/Agent/connection, not actual owner grants or production.

## Security bug observed and reproduced BEFORE fixing

The non-`pairingRequired` branch in `DeviceAccessGrantRegistry.poll` originally prioritized an independently active grant over this request's own terminal owner decision:
1. A and B both created as pending for the SAME fake account/device/Agent/connection.
2. Request A was approved, creating an active grant.
3. Owner explicitly denied B.
4. Poll B with its OWN correct poll token incorrectly returned `approved` using A's active grant because `if(active)` executed before `if(row.state==='denied')`.

Similarly, if pending B's B-code/request expiry elapsed while A's grant remained valid, B's poll returned `approved` rather than `plus_authorization_expired`. These are *real state machine precedence errors*, not a lack of independent signing alone. Both negative tests failed with `Missing expected exception` against the previous version.

## Narrow correction

Change ONLY the non-pairing poll branch in `operator-host/device-access-grant-registry.mjs`:
- Always reject explicit `row.state==='denied'` first (403), irrespective of other concurrently approved requests.
- Reject explicitly expired rows and **pending** rows that exceed their own expiry (410), persisting the newly expired terminal state.
- Permit the existing merge/reuse behavior only for requests that are still PENDING and within expiry.
- Preserve the legitimate case where this same request was **already approved before expiry** and its grant remains active: a client polling after the short B-code expiry can still receive that already approved grant. If no matching active grant remains for this approved request, it returns `device_access_grant_required`, not pending or an unauthorized new grant.
- Do not close A when owner denies B; denied outcomes remain independent. No code changed in global auth, real Wall, blocked Agent startup wiring, owner/issuer or production command execution.

## Red/green runtime test evidence

New real-registry `platform-v2/test/device-access-denial-priority.test.mjs`:
1. Two simultaneous pending requests for same Agent; approve A, deny B, B's valid token must get 403; independent grant A remains valid; fresh registry reload from state file still denies B. RED before fix, GREEN after.
2. Two concurrent requests; A approved, B expires, B's valid token must get 410 even with A grant active. RED before fix, GREEN after.
3. Legitimate still-pending unexpired B can reuse a separately approved A grant, retaining old behavior. GREEN both before/after.
4. Delayed poll on the *same* request approved before B-code expiration must still succeed while grant is active. This compatibility regression caught an overbroad initial guard (RED) and was fixed (GREEN).

Observed VPS-ARM:
- **4/4** new actual-registry tests PASS.
- **61/61** full platform Node suite PASS.
- **11/11** P0 release-negative guards PASS.
- **14/14** writer-source guards PASS.
- `node deploy/scripts/selftest-v11-device-connection-renewal.mjs` PASS.
- Writer source audit remains **NOT_READY (16/18 fsync; global writer authority absent)**.
- Older standalone `selftest-v09-device-access-grant.mjs` was attempted but its legacy output location writes directly under world-writable `/tmp`, rejected with `durable_state_untrusted_directory` by the intentionally hardened atomic-file writer. No directory permission bypass or disabling safeguards was attempted. The new state-file test creates a private isolated test directory instead.

## Limits

This fixes denied/expired request-state priority in one registry, but **does not** create the independently authenticated owner proof, issuer verifier, signed device-channel ACK, durable PG nonce, physical Agent effect fence or global writer epoch. The new opt-in strict Local Wall constructor from `590f1df` remains UNWIRED into operator-agent following a tool safety block. The two previously blocked fsync registry paths and cross-host sealed backup are untouched. P0-B, P0-A, P0-C, P0-D and P0-E are all **NOT_READY**. No production/main changes. Do not equate native CI success with real owner approval E2E.
