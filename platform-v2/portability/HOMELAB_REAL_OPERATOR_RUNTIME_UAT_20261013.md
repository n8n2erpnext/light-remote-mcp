# Light Remote rc50 — actual Operator restart/freeze integration, HOMELAB UAT (2026-10-13)

**Scope:** feature/rc50-mjs-scale-20261011, based on `ccc8059dd98b1dbe921f186628afbbb17ae3a4f0`. No production change or main merge.

## Independent HOMELAB x64 test
Authorized HOMELAB Light Remote pairing used. Cloned Git via SSH initially failed because HOMELAB lacked a GitHub public-key authorization; no private SSH key was copied. An immutable source-only Git archive from the clean ARM branch was transferred in 11 encoded file chunks through the connected structured file interface, reconstructed and SHA-256 verified before extraction. `5,316,291` bytes, SHA-256 `f41c8d6da2fbeab3048fe2b7414fbfbb016991835dd0b00dec6b8a7ee400a197`, 911 source files in `/home/thaiduy/light-remote-rc50-uat`, not production state.

HOMELAB lacks host-global Node. Used ephemeral isolated `node:22-alpine` Docker image with `--network none`, 0.75 CPU, 768MB RAM, read-only mounted UAT source, read-only root and 256MB tmpfs to run 51/51 Node tests. Python negative tests: 11/11 writer guards, 7/7 release gates PASS; source audit remains NOT_READY 16/18 file fsync proven and global writer false.

Private HOMELAB `postgres:17-alpine` + `redis:8-alpine` test fixture used the existing `platform-v2/compose.yml`, internal-only network and no published host ports. Initial Redis failure due to synthetic `redis.conf` mode 0600 was corrected only in disposable UAT credential directory to mode 0644; PostgreSQL and Redis became healthy. `scripts/check.sh` then required a Node executable absent from the host; a staging-local `node` wrapper ran Node22 in an isolated Docker container without global installation. Complete test ultimately exited 0 with `RC50_V2_PLATFORM_UAT_PASS`: migrations 1..7, all SQL rollback checks, tenant and ACL guards, Team 5 seats contention, worker leases and outbox unique claims, no exposed DB ports. Exit trap removed only the dedicated test Compose project. Independent check showed ZERO remaining UAT containers, networks or volumes. Scratch test credentials and transfer chunks removed.

## New real Operator runtime smoke in the branch
`platform-v2/test/operator-runtime-smoke.test.mjs` is a committed-to-repo candidate that actually SPAWNS `operator-host/executor.mjs` on a Unix-domain socket in a private OS temp directory with `OPERATOR_INTEGRATED_HOST=0`, no real device binding, fake account/device IDs, fake unconfigured encryption key, separate state/log/marker paths. Tests:
1. Real Operator GET /healthz returns healthy and local freeze OPEN.
2. Real Operator accepts GET /v1/capabilities before freeze.
3. SIGUSR2 freezes, writes fsynced marker and reports FROZEN with no in-flight requests.
4. New capabilities HTTP gets 503 `local_ingress_frozen`.
5. SIGTERM gracefully closes the real spawned Operator process.
6. A fresh spawned process with same marker refuses to boot.
7. Even disabling the dev freeze opt-in while retaining the marker path still refuses to boot.
All child processes and UAT filesystem roots are cleaned within the test, even on failure. **No production Operator/Plugin service signal** is sent. This is local startup/freeze integration, NOT global writer/Agent epoch proof.

VPS-ARM: new test **1/1 PASS**, entire source suite **52/52 PASS**. The existing CI workflow already runs `node --test platform-v2/test/*.test.mjs` on both native x64 and ARM64 runners; therefore this test is included automatically after push. GH Actions must be checked on the NEW HEAD, not assumed based on local PASS.

## Limitations / P0 remain open
- 16/18 file writer durability; account and connection registry source edits previously blocked.
- No real shared writer authority/epoch across Operator/Plugin/Fleet/Agent. Previously blocked PG adapter source was NOT recreated by alternate tool.
- Local marker can fail to persist before process crash; it cannot fence other hosts or unregistered Agent side effects.
- Real owner A/B → verifier/issuer/Agent cryptographic trust path and full state backup/restore were not verified.
- HOMELAB validates SOURCE transfer + independent fresh fake PostgreSQL/Redis instance. NOT a copy/restore of real ARM state or a global-consistent multi-plane snapshot.
- Explicit release `--require-ready` remains fail-closed. All five hard P0 gates still NOT_READY. Keep Node ESM .mjs + Express5, feature-only.
