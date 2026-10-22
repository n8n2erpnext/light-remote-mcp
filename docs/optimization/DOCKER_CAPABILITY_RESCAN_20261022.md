# Docker capability rescan — 2026-10-22

Scope: independent Gold fix. **M plan remains HOLD**. Do not resume M6, apply migration 035, release Gold UAT/production, drain workers, or alter resource claims for this change.

## Root cause

The Linux Agent detects Docker CLI via `commandExists('docker')`. An ordinary leaf enrollment freezes that observation in `grantableCapabilities`. `updatePolicy` rejects capabilities absent from the frozen list. Installing Docker later does not automatically expand the server authorization ceiling; selecting Full access locally cannot override the server. HOMELAB already had Docker and advertised it; HOMESV had no Docker in its original enrollment (rc.47).

## Fix

- Local Wall `/permissions` adds `Rescan installed tools`; POST `/api/capabilities/rescan` is CSRF-protected and requires the existing Local Wall authentication.
- Agent discovers current tools on demand, submits a signed device-channel request using the already enrolled Ed25519 identity (no A/B re-enrollment, no key rotation).
- Gateway proxies `/device-channel/capabilities-refresh` to the authenticated Operator route; `verifiedChannelContext` binds action, nonce, timestamp, device, and account.
- `EnrollmentRegistry.refreshDiscoveredCapabilities` updates `grantableCapabilities` and intersects previously approved rights with detected capabilities; **new capabilities remain unapproved**. Any removal revokes previous approval. Revision increments and the Operator returns a signed policy envelope. PostgreSQL Gold native binding fields already cover both arrays and policy revision; no new database migration is required.
- Agent adds newly discovered capabilities to Local Wall's explicit deny list. Owner must approve the capability through Account/Fleet device policy, then allow it at Local Wall. No permission is auto-escalated.
- Linux inference treats only exact `command -v docker`, `which docker`, and `type -P docker` as diagnostics. Chained commands, substituted commands and actual Docker execution still require `docker` capability.
- Trusted main host continues using its existing `ensureTrustedBinding` path (refresh at Operator restart). The new explicit rescan request is for normally enrolled leaf devices, not an implicit trusted-main privilege escalation.

## Acceptance

Run: `node deploy/scripts/selftest-docker-capability-refresh.mjs`, `node deploy/scripts/selftest-enrollment-registry.mjs`, `node deploy/scripts/selftest-gold-linux-service-command-inference.mjs`, `node deploy/scripts/selftest-gold-linux-systemctl-whitespace-boundary.mjs`.

Only after a separately authorized Gold rollout should HOMESV be tested: install Docker if actually desired, verify binary in the service account's PATH and Docker socket permissions, click Rescan, inspect Account/Fleet policy pending Docker, approve as owner, allow locally, and run read-only `docker version`/`docker ps`. Docker binary presence alone does not confer access to daemon socket. Do not run reinstall for capability refresh.

## Status

Source patch in separate branch/worktree only. **Not deployed** to Gold UAT or production. M6 cutover and its work/claims remain untouched. Verify signed native PostgreSQL write/read, current packaging, and UAT on approved release lane before claiming deployed fix.
