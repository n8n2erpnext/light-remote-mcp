# Gold G2 — NativeProcess asynchronous stdin EPIPE hardening (2026-10-19)

**Milestone: G2 IN PROGRESS. Source regression GREEN and real Gold Agent behavior checked.** Branch `feature/light-remote-gold-rebuild-20261018`; starting pushed HEAD `066eddb`. Gold LXD only; no production change.

## Verified RED root cause
Before patch `lib/native-process.mjs::NativeProcessRegistry.input()` called `row.child.stdin.write(buf)` without a `child.stdin.on('error')` handler. An isolated Node test spawned a harmless child that closed fd 0 but remained alive, then sent nonsecret stdin input. Node emitted **unhandled `write EPIPE` on the child's parent-side Socket** and terminated test Node with **exit code 1**. Trace pointed to `NativeProcessRegistry.input()`. In a long-running Agent, the same unhandled error can terminate the Node process rather than merely fail the input operation.

This is a proven local library bug independent of the separate OpenAI pre-dispatch refusals. No provider filter behavior was inferred.

## Minimal patch
- `lib/native-process.mjs`: register `child.stdin` `error`/ `close` listeners. An asynchronous EPIPE now records bounded `stdinState='error'` and allowlisted `stdinErrorCode='EPIPE'`, emits only safe metadata (no stdin payload), and does not crash the owner process.
- `input()` returns typed `process_stdin_unavailable` (HTTP 409) for subsequent writes to a closed/error/ended stream. EOF marks `stdinState='closing'`. Retain process ownership verification, maximum input size and existing stop/timeout behavior.
- `view()` returns `stdinState` and `stdinErrorCode` alongside existing process fields. This is additive, no existing output ring or protocol removal.
- `plugin-server/tool-error-classification.mjs`: add exact `process_stdin_unavailable` and `process_not_running` as `layer=process`, nonretryable, with `inspect_process_stdin_state` or `inspect_process_state` next actions; G1 regression test updated. No auto-retry on non-idempotent stdin.

**Limitation:** the first `process_input` call can return successfully before a later asynchronous pipe error fires. The durable output/status response then reports the negative stdin state. Do not claim the initial acknowledgment proves the child consumed the data.

## Verification
1. Before patch: isolated RED fixture printed `G2_CLOSED_CHILD_STDIN_READY`, then unhandled `write EPIPE`; test Node exit 1.
2. After patch: `deploy/scripts/selftest-g2-process-stdin-epipe.mjs` PASS: process stays alive through asynchronous EPIPE, `stdinState` becomes closed/error, subsequent input rejected, owner mismatch preserved.
3. Existing `selftest-v10-native-process.mjs` PASS and `selftest-g2-process-output-drain.mjs` 6/6 x 1 MiB stdout PASS; no speculative `exit`/ `close` rewrite made.
4. Real isolated Gold MCP: started a test-only long-running Node child with closed stdin on the authorized Gold Agent; first `process_input` was accepted, subsequent `process_output` reported `stdinState='error'`, `stdinErrorCode='EPIPE'`, Node/Gold MCP still responded, and test process later ended cleanly. A delayed retry after the child exited correctly returned `process_not_running` (observed before corresponding classifier update).
5. The additional `process_not_running` mapping is a separately reproduced outcome; must run updated Gold Plugin after deployment to verify live label. Source-only regressions are not equal to live acceptance.

## Safety, scope and next G2 work
No production modification, secret disclosure, authorization weakening, Terminal/PTy bypass, new JSON/SQLite state, DB migration or output buffer size change. This patch applies to both Gold Operator-local and Gold Agent registries when their Node processes are restarted with the updated module.

Continue bounded spawn failure, process cancel/timeout, PTY stop/resize, reconnect, and Windows/macOS tests. Prior G1 unknown pre-dispatch events remain in `RDC_G1_UNRESOLVED_REFUSALS_20261019.md` but are not a prerequisite for moving through G2–G6.
