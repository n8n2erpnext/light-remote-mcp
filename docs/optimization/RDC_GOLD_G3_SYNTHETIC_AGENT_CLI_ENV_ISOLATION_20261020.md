# G3 Gold — Isolate synthetic Agent CLI enrollment from inherited live identity and Wall bind

2026-10-20 | Branch `feature/light-remote-gold-rebuild-20261018` | Prior commit `5f000fd`.
Scope: regression fixture **test isolation only**, not weakening Agent identity or wall authentication.

## Root cause reproduced
Running existing `deploy/scripts/selftest-device-agent-cli.mjs` on VPS-ARM initially **FAILED** `cli_pending_state_missing` before its synthetic enrollment could finish. The host had a legitimate inherited `OPERATOR_AGENT_IDENTITY_FILE` set by the real Light Remote installation. The fixture created its own state, but did not clear the inherited key path; the true Agent correctly used its configured external Ed25519 identity and omitted the private key from the fixture's state JSON, which conflicted with the fixture's old assertion.

First targeted correction cleared `OPERATOR_AGENT_IDENTITY_FILE` **inside child-process environment only**. The next run progressed through enrollment, but then **FAILED** `daemon_local_wall_not_ready`. Host also inherited `OPERATOR_AGENT_WALL_HOST=100.94.184.141` and Fleet Wall bind host. The test attempted to connect to `127.0.0.1`, while its child daemon bound its Wall to the real host NetBird address, as configured.

## Targeted fix
Only `deploy/scripts/selftest-device-agent-cli.mjs` was changed:
- All synthetic CLI children clear `OPERATOR_AGENT_IDENTITY_FILE:''` so each ephemeral fixture generates a fresh Ed25519 key. This deliberately prevents a test from loading the owner device's external identity.
- The synthetic daemon child clears the inherited identity file and sets `OPERATOR_AGENT_WALL_HOST='127.0.0.1'` and `OPERATOR_FLEET_WALL_HOST='127.0.0.1'`, while retaining the fixture's dedicated randomized wall port, **authenticated** local wall configuration and all existing signed protocol assertions.
- No runtime Agent source, security policy, persisted identity, Local Wall owner binding, public API, plugin, production, or business database changed.

## GREEN evidence
Command `node deploy/scripts/selftest-device-agent-cli.mjs` in the Gold worktree on actual VPS-ARM ARM64 Node 22.23.1: all **11/11** original markers PASS:
fresh enrollment dormant, daemon signed channel, clean daemon shutdown, local key 0600, no secret output, signed certificate, signed heartbeat, final local deny policy, revoked state for Wall reenroll, reenrollment respecting full grantable capabilities and the local deny, return to dormant.

Actual `light-remote-gold-uat` LXD ARM64: staged updated fixture to `/tmp/g3-real-daemon-lifecycle-20261020/deploy/scripts/selftest-device-agent-cli.mjs` alongside the full staged source and assets, executed real Node fixture inside container. All **11/11 PASS**. Source and staged test SHA-256 both `02606a95c2aec226b3c571144911ee63b67a3830c925281a5b7b65065628f1ff`.

## Hosted CI
- New `gold-g3-cli-enrollment-fixture` job runs this **synthetic** Agent CLI enrollment on an isolated Linux runner with deliberately inherited **invalid** test-only `OPERATOR_AGENT_IDENTITY_FILE` and non-loopback wall/fleet host values. The fixture must override both or fail, preventing accidental regression back to using real device identity.
- Linux Desktop x64 and ARM64 Client packaging workflows also run this fixture. macOS lifecycle and signed duplex tests remain separately enforced; no claim of new macOS CLI enrollment test.
- At exact source `b6b96b6b6ac330365226e6f69946f4ed56dc9997`, [Gold G3 Operator CI #9](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39434854513) **6/6 SUCCESS** including the isolated synthetic CLI test, real-Agent lifecycle, bounded soak and x64/ARM64 server bundles. CLI job log confirmed original eleven PASS markers; probe lifecycle job log also contains `G3_REAL_DAEMON_RESTART_NO_ORPHAN=PASS`. [Linux Client #291](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39434854523) **x64+ARM64 SUCCESS**; inspected each job log for genuine CLI enrollment, signed channel, re-enrollment and clean daemon lifecycle PASS markers.

## Important boundary
The server in this CLI fixture provides synthetic approval and signs synthetic certificates; it is not the live, account-approved Gold Operator. This is real CLI/Agent/WALL/crypto OS test but not the missing Gold owner approval acceptance. Do not call it live enrollment. No production credentials were copied and no runtime owner identity was modified. G3 still OPEN for approved disposable device and real-service command/reconnect acceptance.
