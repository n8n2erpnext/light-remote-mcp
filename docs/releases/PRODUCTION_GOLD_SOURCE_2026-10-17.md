# Light Remote — production gold source, 2026-10-17

**State:** clean DEVELOPMENT BASE only, not deployed, not a production/database backup.
**Git worktree/branch:** `feature/production-gold-pg-redis-20261017`.
**Git base:** `origin/main@12bb746ca3e13e493ac5f634e79f8dda8b3d2ce0`.
**Read-only reference:** VPS-ARM LXD `light-remote-direct`, service `light-remote-direct-operator` and `light-remote-direct-plugin` running, symlink `/opt/light-remote-direct/current` -> release `ux-v5-device-os-20261009-r4`.
**Release manifest:** actual installed `VERSION=0.9.0-rc.47`; manifest origin SHA `218fd3aa45ece9ed04b30ee341c3499945483f47` but deployed source has additional post-build overlays. That original manifest SHA ALONE IS NOT full runtime identity.

## Composition — verified source, no secrets/data

1. Use latest accessible Git `origin/main@12bb746` for full repository and **unmodified native client sources**. Do not downgrade Windows/macOS/Linux client subtrees to an old rc.47 installed Agent.
2. Overlay **exact code/assets from the deployed production release** onto `operator-host/`, `plugin-server/`, `lib/`, `gateway/`, `assets/` only, excluding `node_modules`, runtime binaries, state/config/secrets, `.env` and `.git`.
3. Do NOT use stale `ux-v4-*` release as the full build or derive it from the old `main@f2e0880`. Current Home HTML retains V4 look but Downloads and CSS contain later R4 updates; `admin-portal.mjs` includes GET `/admin/api` route-order fix, device-OS metrics and site analytics.
4. Keep current distribution endpoints, R2 and updater manifests untouched. The public `/downloads/manifest.json` still describes channel `0.9.0-rc.47`, including published Windows/macOS/Linux checksum/URL entries. The **development branch is not a signed update release**.
5. Source for rc.50 Team, Inbox, Bell, Notification Center and AI Guide improvements is the clean independent branch `feature/free-benefit-pro-team-20261010@6ab88ecebd601c9b25da71f92570fa8cac9c4523`, not the P0 WriterEpoch branch. Its 11 checked functional files were byte-identical to the test LXD staging on 2026-10-17. Selectively port into the new branch after gold commit and tests, preserving production V4/R4 UX.
6. Historical rc.50 P0 code and docs remain as *reference only*, NEVER cherry-pick bulk WriterEpoch/freezing/PG effect authority into this base. No products or capabilities get auto-enabled without verified authorization.

## Critical deployed code source SHA-256

- `operator-host/executor.mjs`: `9c0eea764e477a391b1c135598ba61d36d8212fa6cdbdc688f2c71134e428fa9`
- `plugin-server/server.mjs`: `3a1637033fbb82833cc908b431d88ccbd8267daac84fb28203f30088e36a6c59`
- `plugin-server/public-home.html`: `e25e66d42c6305524dd97133dc648f7436573266a65c428e15dc7b726b593052`
- `plugin-server/downloads-portal.html`: `c6795d6f1b3507c72845cb936d03b6ea898b050085092c0f35bad6ddc749c9af`
- `plugin-server/account-portal/visual-system-v4.css`: `ef9c0286925aa50509ad10199be660a638bddceab36370921c064458a5d394c4`
- `plugin-server/ai-guide.md`: `184f341458cf2dd50400647d35cebcb91e53b0f16b55699ff684dea6dec9e4eb`

Each SHA-256 was compared against read-only LXD installed release after the code overlay. This is **source integrity**, not complete runtime/end-to-end acceptance.

## PostgreSQL / Redis migration scope (NOT YET COMPLETED)

- Existing rc.50 UAT Docker ran `postgres:17-alpine` and `redis:8-alpine`. Rebuild **new named volumes and credentials** for this branch; do not import discarded P0 test database, fixtures, OAuth or account state.
- PostgreSQL must hold all business/durable application state; Redis is cache/TTL/coordination only, never sole source for durable billing, device identity, authorization or notifications. Operator/Plugin must not silently fallback to legacy JSON when PG is unavailable once migration mode is explicitly activated.
- Preserve production immutable IDs and revocations only through a later separately authorized controlled cutover, not through this source-gold construction. Current production application and database stay untouched.
- Before deleting old UAT LXD/containers/volumes, verify all desired rc.50 source and docs exist outside the instances; no test state backup was requested or will be created.

## Release guard

This commit is a candidate source provenance checkpoint only. No GitHub `main`, native updater channel, public plugin, production Docker/LXD, OAuth, Paddle or billing modifications are permitted by this document. Carry forward A/B flow and production route protections. Test source and build before promoting anything.
