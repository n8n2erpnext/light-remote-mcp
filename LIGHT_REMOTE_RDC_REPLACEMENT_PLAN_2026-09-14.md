# Light Remote — RDC replacement / post-connect parity plan

Status: ACTIVE implementation plan. Supersedes the 2026-09-13 parity plan while preserving its P0 debts and invariants.
No tag/release/stable channel without owner approval.

## Product target
Light Remote may remain slower/more ceremonial only at the temporary ChatGPT -> Vercel compatibility/pairing edge. Once status is READY, normal engineering work must feel native and continuous: one exact target, one durable working context, structured file/process/search tools, streaming output, no repeated pairing/session plumbing, and no shell-quoting gymnastics for structured operations.

## Frozen invariants
- Exact target always explicit; never silently fall back to another device.
- Local device policy is final deny; Fleet/Main cannot override it.
- Main is account-level; Fleet requires current Main + entitlement + signed device channel.
- Browser/Tray lifetime never owns Agent/runtime lifetime.
- Revoke preserves device identity/history; Remove purges active identity/bindings so reconnect is a new device.
- Operational audit remains subject to normal retention; Remove does not rewrite history.
- Generic shell/PowerShell remains a high-risk escape hatch, not the default file/process API.

## P0A — finish already-built dogfood hardening live
1. Roll commit `44af0d2` to live ARM Gateway/Operator and signed Fleet component path.
2. Live-accept Connection Helper + Copy-A capsule, scoped Plus limiter, 12k compatibility cap, continuation recovery, favicon/brand/version reporting.
3. Live-accept Remove end to end and Main/Fleet invalidation semantics.
4. Live-accept Wall hot stream: 8 MiB default, 10 MiB hard cap, 15 min age, SSE before async disk, 50 ms render batching.
5. Finish Main ARM <-> AMD <-> Windows acceptance and restore intended Main.
## P0B — post-connect fast context
6. READY establishes a durable working context bound to client, exact device, stable Agent ID, session and workspace.
7. Reuse that context for normal calls; do not require list-devices or session-open again unless target changes or context is truly expired/revoked.
8. If client survives but device binding is gone, return `re_pair_device` directly instead of a blind session-open failure.
9. Add a compact context/status endpoint for recovery without broad account enumeration.

Acceptance: after READY, a 30–60 minute engineering session should not ask the user for A/B again unless revoke, remove, hard lease expiry, or connection identity change occurs.

## P1A — native filesystem plane
10. Replace shell-backed convenience file tools with device-side structured operations: read, multi-read, write, edit-block, stat, list, mkdir, copy, move and delete.
11. Add bounded range/tail reads, recursive bounded listings, overwrite/recursive flags and atomic rewrite where practical.
12. Enforce filesystem read/write roots on the device; generic exec policy remains separate.
13. Return structured metadata plus truncation/next offsets instead of shell-formatted text.

Acceptance: editing code containing dollar signs, backticks, quotes, Unicode or template literals must not require base64/Python/shell escaping.
## P1B — interactive process plane
14. Add native process start, input, output, list and stop operations with explicit lifecycle states.
15. Start returns a process handle quickly; output is incremental with offset/tail and bounded memory.
16. Preserve exit code, timeout and first-output timestamps.
17. Long-running processes must not block an AI turn until completion.

## P1C — search v2
18. Add asynchronous search start, results and cancel operations for files and content.
19. Support literal or regex matching, file patterns, case handling, context lines, result limits and pagination.
20. Search returns a handle immediately and may continue in the background.
## P1D — transport after READY
21. Keep 12k GET as temporary compatibility only.
22. Add a chunked structured-payload path so large code edits are not packed into one URL.
23. Reuse that transfer foundation later for Light SCP with integrity, resume and atomic destination semantics.

## P1E — latency telemetry
24. Record bridge receive, Gateway accept, Device receive, first output, completion and Wall display timestamps.
25. Report bridge, dispatch, execution, first-byte and Wall latency separately so Vercel overhead is measurable.

## P2 — platform polish and transfer
26. Complete Light SCP and chat attachment adapters.
27. Finish Windows/Linux/macOS installer and independent updater acceptance.
28. Finish Fleet signed-component rollout and multi-device product polish.
29. Rich document/image semantic parsing remains deferred.

## Final RDC-replacement acceptance
Use ARM Hub/Main, AMD Linux leaf and Windows DESKTOP-VA16D27. After one connection, use Light Remote—not RDC—for structured file read/edit/move/delete, Git status/build/test, process start/output, search, service/log inspection, one governed maintenance action, durable job recovery, Wall observation and Fleet explicit-target operations. RDC is bootstrap/rescue only after this matrix passes.

## Checkpoint 2026-09-14 — source implementation complete, rollout pending
- P0B durable READY context, P1A native FS, P1B native process, P1C Search v2, P1D chunk transport and P1E latency telemetry are implemented in source.
- Light SCP foundation is implemented for upload/download, integrity, resume, owner isolation, exact Fleet routing and crash replay protection.
- Device installer/runtime packaging and Gateway flat-build packaging were audited and fixed for the new dependencies.
- P1D compatibility transfer uses 5 KiB chunks and a 5 MiB raw assembled-payload cap so the sealed envelope remains below the Operator HTTP body limit.
- P1E records bridge receive, Gateway accept, Operator accept, Device receive, first output and completion; Wall display latency is measured in browser memory without an extra telemetry request.
- Production source has no `light_remote_search_text` registration; the earlier audit hit was a selftest literal only.
- Final repository selftest gate: 82/82 PASS, 0 FAIL; focused transfer, Light SCP, packaging, Wall and latency gates PASS; `git diff --check` PASS.
- Exact-target, client/device/session/agent binding and local-policy-final-deny invariants remain preserved.
- This checkpoint is source-only. No deployment, tag, release or stable-channel promotion has been performed. Live ARM/AMD/Windows dogfood and final RDC-replacement acceptance remain pending owner-controlled rollout.
