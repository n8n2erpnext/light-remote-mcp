# rc50 P0-C — real Operator local lifetime drain census (partial)

**Date:** 2026-10-16 Asia/Ho_Chi_Minh
**Scope:** feature/rc50-mjs-scale-20261011, baseline `bc59cbe288516fb61eb0f241d07918e5d4d337d6`. No deployed service changes.

## Source-level safety gap closed

Actual `operator-host/executor.mjs` previously registered the `jobs` map as the only explicit external pending source. A real native `process start` or `terminal start` job is marked finished when the command's *start request* completes; the spawned OS process/PTY can stay alive beyond this point. Therefore `SIGUSR2` local freeze could report `frozen` with `inflight=0` and `operatorJobs=0` while still-owned local OS commands run. This is an unsafe local checkpoint ACK, independent of the global fence gap.

## Narrow correction on actual Operator

- Register `nativeProcesses` and `nativeTerminals` as separate `LocalIngressFreezeGate` pending sources. Each counts all records without `finishedAt` using actual `NativeProcessRegistry.list()` and `NativeTerminalRegistry.list()`, irrespective of which account/session started them.
- Wire `process_finished` and `terminal_finished` events to `notifyPendingChanged()` after registry state is marked complete. Local frozen ACK is delayed until both lifetime censuses reach zero and existing durable audit `beforeDrained` seal completes.
- Do NOT proactively kill a user's process/PTY on SIGUSR2. A long-lived process may cause an intentional indefinite `freezing` state, rejecting new HTTP with 503. Owner reconciliation / explicit stop is still needed. This is safer than reporting a false completed cutover.
- Marked `local` only. Remote Agent PTY/process state, other hosts, SCP transfers, Fleet queue/in-flight device effects, external billing/usage writers and all multi-host authority remain **unfenced**.

## Verification

- New `platform-v2/test/operator-native-lifetime-freeze.test.mjs` runs a **real Node child OS process** and a controlled fake PTY provider against the real registry classes and gate: both remain active after their request-job completes; freeze stays `freezing` with pendingExternal 2; stopping PTY alone leaves pendingExternal 1; only after child exit does the gate resolve `frozen`, with 0600 marker. A separate source guard verifies both registrations and finish callbacks are present in the actual Operator.
- Focused regression **2/2 PASS**.
- Full `node --test platform-v2/test/*.test.mjs` **63/63 PASS** on VPS-ARM ARM64.
- Writer audit stays **16/18 fsync-proven**, `single_writer_authority_proven=false`, status **NOT_READY**. P0 release guards and writer-source guards remain PASS; `git diff --check` and JS syntax PASS.
- GitHub Actions native ARM64/AMD64 result must be independently verified after commit/push; local tests are not CI certification.

## Explicit remaining P0 blockers

P0-A lacks global durable lease / epoch / revocation applied to every Operator/Plugin/Fleet/Agent writer. P0-B lacks independently authenticated issuer + real signed owner/Agent approval. P0-C still lacks two previously policy-blocked registries, all remote Agent effects, checkpoint generation/watermark and full cross-plane freeze. P0-D lacks complete fake representative ARM64→HOMELAB AMD64 restore/rollback under a single authority. P0-E requires whole-system E2E/release and installer checks. **Do not mark any gate ready, merge main or cut over production** on the basis of this partial local fix.

Earlier safety blocks on account/connection registry writes, strict Agent Wall startup wiring, global PG runtime adapter and sealed cross-host backup were not retried or bypassed.
