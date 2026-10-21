# G3 Gold Redis / Local Wall — real LXD UAT cutover, 2026-10-21

## Scope, version, provenance

Branch `feature/light-remote-gold-rebuild-20261018`, pushed commit `ac97414111bb77f0e18c9ef1eb22fc6d7fedd554`. Owner expressly requires **Gold-only**, no production change.

- VPS-ARM official Light Remote connection was explicitly reauthorized through new Local Wall A/B before work.
- Gold isolated LXD: `light-remote-gold-uat`; old active candidate `15eed24fa400feccfb6156df7959c78a8aa437af`, new immutable `/opt/light-remote-gold-uat-candidates/ac97414111bb77f0e18c9ef1eb22fc6d7fedd554`.
- Existing public preview `https://gold.light-remote.thaiduy.digital` remains behind NetBird/Traefik/Gold Nginx. The production web/domain `https://light-remote.thaiduy.digital` and separately installed production Local Wall process were not redeployed. **Screenshot `wall.dashboard.thaiduy.store` is production and may still display `status rate limited`; this Gold UAT rollout must not be represented as a live production UI fix.**
- Cloudflare Proxy/CDN/WAF/Workers are not in the Light Remote Gold architecture; existing R2 GitHub Release binary storage remains unaffected.

## Implementation and test

See [G3 Redis + Local Wall RCA and source patch](./RDC_GOLD_G3_REDIS_WALL_RATE_LIMIT_20261021.md). Gold Operator now uses Redis atomic per-signed-device/lane minute limits, preserving 240/min default observer quota; Redis errors fail closed 503. Wall singleflight status cache 12s, retry-after and visible stale state; manual B code approval bypasses TTL. The new Wall module is in both client packaging manifest and host installer.

- Synthetic 7-marked tests PASS: cross-instance Redis quota; device/lane isolation; fail-closed/namespace; multi-tab single-flight; stale+429 retry; disconnect invalidation; immediate approval freshness.
- Local Wall Executor readiness regression and strict admission source regression PASS.
- **Actual Gold LXD Redis**: authenticated `gold-uat` user created an ephemeral test key, demonstrated shared quota and TTL, then removed it. No Redis URLs or credentials exposed.
- Cross-platform client manifest, host installer shell syntax, Gold CI YAML parsing and JS source syntax PASS.
- Prior real Windows #453 read-only result through isolated Gold proxy restart: single completion in activity, no observed job redelivery; no claim of global exactly-once.

## Guarded immutable promotion actually performed

1. Prior Gold state: 5/5 UAT services active, 2/2 outbound channels fresh/ExecutorReady, strict OFF. A remaining active session was our own old Gold tool session; closed safely via `light_remote_close_session`. Fleet gate thereafter **active=0, queued=0, inFlight=0**.
2. Git-archive of exactly `ac974141` staged into isolated Gold container using `gold-g3-stage-candidate.sh`; **G3_GOLD_CANDIDATE_STAGED, PACKAGE_LOCK_PARITY, LIVE_SERVICES_UNTOUCHED PASS**. First transport attempt failed because Snap-confined LXD could not read a tarball in shell `/tmp`; using a fixed owner cache path resolved it, without changing services.
3. `gold-g3-uat-backup.sh`: verified code, existing systemd overrides, local state and PostgreSQL dump; `G3_GOLD_BACKUP_VERIFIED=PASS`. Backup path: `/var/backups/light-remote-gold-uat/pre-g3-ac97414111bb77f0e18c9ef1eb22fc6d7fedd554`, SHA256SUMS stored inside LXD. Previous active immutable candidate preserved.
4. `gold-g3-uat-cutover.sh` with explicit `G3_GOLD_CUTOVER=1`: **NO_ACTIVE_JOBS, PREVIOUS_OVERRIDE_SNAPSHOT, CANDIDATE_CUTOVER, STABLE_HEALTH_10_SAMPLES PASS**, exact source SHA active. Only three Gold services restarted in order: Operator → Plugin → Wall; no other LXD/container, NetBird, Cloudflare, production app or public Nginx changed. **Strict OFF**.
5. Post-deploy Gold Fleet: **5/5 UAT units active, 2/2 fresh and ready, zero queued/inFlight, strict OFF**. Gold and production home URLs both returned HTTP **200**.
6. New officially A/B-authorized **Gold Windows #453 signed PowerShell job** on physical `DESKTOP-VA16D27`: marker `G3_GOLD_REDIS_CUTOVER_SIGNED_DISPATCH_PASS`, correct hostname, exitCode=0; closed only the newly created Gold plugin session afterward.
7. Read-only `uat-gold-g3-readiness-audit.mjs` executed against running Gold Operator Fleet with expected source parity SHA: `sourceParity=true`, 2/2 fresh true ready and dispatchable, zero active sessions/jobs, `G3_GOLD_LIVE_OPERATOR_GATE=SOURCE_AND_FLEET_EVIDENCE_PRESENT`. This is **preflight evidence, NOT strict policy activation**.

## Next scope

- Keep Gold UAT on `ac974141`; strict admission remains OFF until bounded physical soak performance/RSS and explicit healthy/unhealthy admission with a rollback gate. Any change should be a new immutable Gold-only candidate.
- Do not confuse Gold-only UAT change with the production Wall screenshot. Production can be updated only after separate owner approval and release.
- Preserve the four inherited untracked Gold deploy/check scripts; no `git add -A`.
- G3 still **IN PROGRESS**. G4 not started. Current handoff and master plan are canonical.
