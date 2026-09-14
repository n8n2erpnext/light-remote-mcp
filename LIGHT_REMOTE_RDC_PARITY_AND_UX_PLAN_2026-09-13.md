# Light Remote — RDC parity + UX hardening plan

Status: ACTIVE implementation plan. No tag/release until owner approval.

## P0 — visible/live defects
1. Brand parity: canonical Light Remote logo on Device Wall, Fleet Wall/login, Account, OAuth/enrollment/policy pages. Add favicon on every web surface and `/favicon.ico` fallback.
2. Main/Fleet migration: finish signed component/live rollout and ARM↔AMD↔Windows acceptance.
3. Account Device actions: keep **Revoke** as history-preserving deny; add **Remove** as destructive purge of active device/account runtime state. Reconnect after Remove must enroll as a new device. Operational audit logs remain subject to normal retention.
4. Wall realtime output: byte-bounded RAM hot ring (8 MiB default, 10 MiB hard cap, 15 minute max age) → SSE Wall first → disk append in parallel; browser batches rendering and keeps DOM bounded. Disk retention/rotation rules stay unchanged.
## P1 — RDC ergonomic parity without weakening governance
5. Interactive process plane: start/input/output/list/stop durable process sessions with waiting-input/running/finished state.
6. Search v2: files/content, literal/regex, glob, ignore-case, context, pagination/searchId/cancel.
7. Filesystem ergonomics: multi-read, richer stat, recursive bounded list, tail/range reads.
8. Filesystem policy roots: separate read/write/upload/download roots enforced device-side; generic shell remains a separate high-risk capability.
9. MCP annotations/token economy: correct readOnly/destructive/openWorld/idempotent hints; offset/limit/truncated/nextOffset on large outputs.

## P2 — Light SCP
10. Chat/device transfer plane: upload/download/status/cancel with explicit target, SHA-256, size, short-lived transfer grant, chunk/resume, atomic destination move, explicit overwrite, TTL cleanup and progress.
11. Chat attachment adapter remains host/plugin-specific; server transport exposes safe raw upload/download endpoints so future ChatGPT/Claude adapters can feed bytes directly without pushing large binary blobs through model context.
## Deferred
Rich PDF/DOCX/XLSX/image semantic parsing is intentionally deferred. Priority is transport + execution + safe filesystem ergonomics; AI clients can already interpret many uploaded formats.

## Invariants
- Explicit device target; no silent fallback.
- Main is account-level; Fleet only on current Main + entitlement.
- Local policy is final deny.
- Remove purges active device/binding/session/grant/connection state but does not rewrite historical audit logs outside normal retention.
- Browser/Tray lifetime never owns Agent lifetime.
- No tag/release/stable channel without owner approval.

## Dogfood defects found via ChatGPT → Vercel → Light Remote
- Plus shared-IP 429: compatibility traffic could throttle unrelated Agent calls. Fixed in source with scoped Plus identities/buckets; live rollout pending.
- GET payload pressure: legacy base64url wrapper at 6000 chars made real code patches fragile. Raised source cap to 12000; structured POST/Light SCP remains the long-term path.
- A/B protocol discoverability: Agent had to know connect/poll/client/session protocol. Added Connection Helper and Copy-A instruction capsule.
- Client/device lifetime mismatch: a valid client can have zero authorized devices after binding/grant expiry. Helper semantics must direct re-pair instead of blind session-open.
- Pair continuation recovery: signed continuation can fail verification in compatibility transport even while approval registry remains valid. Primary signed flow remains; recovery uses requestId+pollToken and server-owned agentId to attach a fresh client.
- Wall rate-limit UX: preserve 429/retry state instead of presenting false disconnected state.
- Wall output latency: synchronous disk append was on the hot path. Changed to 8 MiB RAM ring / 10 MiB hard cap / 15 min age, SSE first, async 50 ms / 256 KiB disk batches, 50 ms browser render batches.
- Async durability regressions: full=1 output now flushes pending disk writes before disk read; idempotency test waits bounded persistence; privileged maintenance update flushes its audit before success response.
- Device lifecycle gap: Revoke was not Remove. Added hard Remove purge while retaining historical audit by normal retention; integrated hub remains non-removable.
- Branding/version drift: favicon coverage added across portal/generated pages; Gateway/guide metadata aligned to 0.9.0-rc.6 without creating a tag/release.

### Dogfood acceptance status
- Source selftests: 71/71 PASS after RDC rescue/fixes.
- No release/tag/stable channel created.
- Live deployment/acceptance still required before marking P0 CLOSED.
