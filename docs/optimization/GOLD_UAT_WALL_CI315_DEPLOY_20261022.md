# Gold UAT Wall-only CI #315 deployment — 2026-10-22

## Scope and source

- **M plan remains HOLD.** This deployment changes *only* `light-remote-gold-wall.service` in LXD `light-remote-gold-uat` on VPS-ARM; it does not restart or replace Gold Operator, Plugin, PostgreSQL/Redis, process supervisor, M5 jobs, resource claims or production.
- GitHub Actions Linux Client Packages [#315](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39799610459) concluded success. Linux ARM64 artifact `gpt-operator-linux-arm64-96628eb2bb33cf29c7a3c76905aef80f84180218`, artifact ID `12434089041`.
- Source commit `96628eb2bb33cf29c7a3c76905aef80f84180218`; package `0.9.0-rc.49`, Node `22.23.2`, target `linux-arm64`, core digest `42e9da76d5d4e8f1b5bf66d186e888882db20b44cbcb3815e0d7dc176877f7ca`.
- Downloaded CI ZIP SHA-256 `1fa088e236a90ac3b71c7bfdcbe91e68f76c51572d13fd04ac175420af8cf999`; CI TAR SHA-256 `e4b287e182f0efd4af243421428b1a27448670903a207504d50258d298291f91`. GitHub CI SHA256SUMS check PASSED.

## Active runtime / verification

- Agent/Wall package staged at `/opt/light-remote-gold-uat-wall-ci/96628eb2bb33cf29c7a3c76905aef80f84180218/package` inside LXD.
- Systemd override `/etc/systemd/system/light-remote-gold-wall.service.d/99-gold-wall-ci-96628eb.conf` points Wall `WorkingDirectory` and `ExecStart` to this package's bundled Node and `device-agent/operator-agent.mjs`. Existing Wall environment and auth state kept.
- A backup of the old Wall state is located at `/var/lib/light-remote-gold-uat/wall/device.json.pre-ci-96628eb` (mode 0600); do not print its contents.
- `light-remote-gold-wall`, `light-remote-gold-operator`, `light-remote-gold-plugin` and `light-remote-gold-process-supervisor` were all active after deploy; non-Wall service PIDs unchanged across restart. Wall `http://100.94.184.141:5591/permissions` returns HTTP **303** redirect to `/login?next=%2Fpermissions`, which is expected for unauthenticated requests.
- UI `CAP_GROUPS` includes grouped PTY and Desktop/Real Remote controls. Browser UI test passed in CI/fixture, not authenticated against this live UAT Wall.

## Known cross-version blockers

1. The running **Gold Operator candidate does not contain** `capabilities-refresh` route. Existing Wall device policy advertises only eight capabilities: `build-test`, `filesystem`, `git`, `lxd`, `package-manager`, `sudo-on-demand`, `systemctl`, `terminal`. This is why new UI can display grouped existing rights but **cannot yet grant Docker/other new capabilities or complete rescan end-to-end**. Operator backend updates require a separately scoped decision; do not resume M plan automatically.
2. New CI Agent emits `terminal_receipt_refresh_failed` with `supervisor_owner_invalid` repeatedly because the existing **M5 process supervisor** does not implement `list-device-terminals` / `ack-device-terminals` API. This is a **real compatibility gap**, despite Wall HTTP/service health passing. Do not claim full process receipt integration has passed. Do not change the M5 supervisor under M HOLD. Track a compatibility fix before using the new Agent for receipt-sensitive jobs.
3. Initial deployment health check erroneously only accepted HTTP 200/302 and rolled back even though the candidate Wall had started correctly (HTTP 303 login redirect). The corrected health check accepts HTTP 303. Prior candidate was preserved throughout.

## Rollback Wall only

If the owner authorizes rollback: remove `/etc/systemd/system/light-remote-gold-wall.service.d/99-gold-wall-ci-96628eb.conf` **inside `light-remote-gold-uat`**, run `systemctl daemon-reload` and restart **only** `light-remote-gold-wall.service`. The former `90-g3-candidate.conf` remains in place and will resume the old runtime. Do not replace saved Wall state unless actually needed and separately justified.

## M plan state

**HOLD remains in effect.** No M migrations, cutover, claim release or job queue changes were made.
