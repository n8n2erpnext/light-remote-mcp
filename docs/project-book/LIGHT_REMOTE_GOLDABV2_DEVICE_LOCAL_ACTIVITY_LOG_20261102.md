# GoldABV2 — Device-local Wall Activity Logs (2026-11-02)

## Authority / branch
- Branch: `feat/goldabv2-device-local-activity-logs-20261102`, based on docs checkpoint `41326829`.
- Scope: GoldABV2 source and isolated Lab Operator logrotate only; no Gold UAT production overwrite, no native build on VPS-ARM.
- Owner requirement: LIVE OPERATOR STREAM commands/output are local working context and debug history, durable on the DEVICE RUNNING Local Wall, across Windows, macOS, Linux, and Linux server.

## Implementation
- Common Device Agent: `device-agent/local-activity-log.mjs`, initialized by `startLocalWall` in `device-agent/local-wall.mjs`, with `activityLogRoot=dirname(STATE_FILE)/wall-activity` supplied from both Agent startup paths.
- Each authenticated/enrolled device writes its own `wall-activity/<deviceId>/activity.jsonl`, plus `.1.gz` through `.N.gz`; no account-wide/global directory. Owned by OS service user, private files 0600 and directories 0700 on POSIX. Windows receives user/service ACL inherited from private Agent state directory.
- Signed, device-scoped activity polling continues even if Wall browser is closed (5s idle / 2.5s SSE live), using `getRemoteActivity`. No automatic cloud export of the local log. Operator backend continues its independent global operational audit log.
- REST: `GET /api/activity` now reads device-local recent activity (and works offline), while SSE forwards sanitized device-local records. RAM ring max 8 MiB / 5,000 events / 60min; Wall browser is separately bounded to 200 jobs, 32Ki chars per stdout/stderr, 5,000 paused events. Replays across restart include rotated archives.
- 50ms disk batch flush, per-event max 64 KiB, JSONL, token/basic secret redaction, gzip rotation, fail closed for low free space (<512MiB) or filesystem errors. Settings errors surfaced to Owner.
- `/settings` > `Activity Logs · This device`: retention presets, used/maximum usage, read last 100 events, Clean Activity Logs with exact typed confirmation and Owner dialog.
- Presets, mandatory rotation:
  - Compact: 16MiB active + two archives = <=48MiB nominal.
  - Standard (default, matches legacy 50MB and 3 rotations): 50MiB active + three archives = <=200MiB nominal.
  - Extended: 50MiB active + five archives = <=300MiB nominal. No unlimited option.
- Owner-only APIs with CSRF: `GET /api/activity/logs/state`, `GET /api/activity/logs/history`, `POST /api/activity/logs/config`, `POST /api/activity/logs/clean` (requires `CLEAN ACTIVITY LOGS`). Clean touches only activity files and stores a purged-before fence to prevent old upstream events being reimported. Never delete Long Memory, Codex, enrollment, or Operator audit data.

## Packaging / OS audit
- Windows native client and macOS installer both stage the canonical `client/core-files.json`. This branch adds `local-activity-log.mjs` and also repairs missing `wall-ui-refinement.mjs` (pre-existing missing R5 runtime import); canonical package verification + `selftest-packaged-local-wall` PASS.
- Linux desktop/server runs same `operator-agent.mjs`/Local Wall and state path; independent module uses only Node builtins and cross-platform path handling. No requirement for logrotate.exe on Windows or Mac.
- Windows/macOS native tray/service OS logs (where present) are distinct from owner-visible Wall activity history; do not mistake them for this feature.
- No actual Windows/macOS native end-to-end installation acceptance yet. Windows builds MUST use GitHub Actions, not VPS-ARM.
- Scope caveat: activity is sampled from device-scoped Operator ring; extremely high event bursts or extended disconnection can still cause upstream gaps. Local archives are bounded and not intended as an unlimited forensic/audit retention system.

## Isolated GoldABV2 Lab Operator logrotate
- Source config: `deploy/logrotate/light-remote-gold-abv2-lab` matches ACTUAL `/var/log/light-remote-gold-uat/operations.jsonl` instead of stale `/var/log/gpt-vps-operator/operations.jsonl`.
- Installed in LXD `light-remote-abv2-lab-20261101` at `/etc/logrotate.d/light-remote-gold-abv2-lab`. `logrotate -d` accepted 50 MiB / 3 rotations; OS logrotate timer active. Existing ~31.3MB file unchanged; no forced rotation. This is independent of Device Agent internal mandatory rotation.

## Source acceptance (2026-11-02)
- `node deploy/scripts/selftest-gold-device-local-activity-log.mjs` PASS: persistence, restart dedup, rotation, archive gzip, limits, redaction, clean fence, low-space gate.
- `node deploy/scripts/selftest-gold-wall-local-activity-http.mjs` PASS: Owner authorization/CSRF, no unlimited config, Clean confirm, background capture, offline local reads.
- `node deploy/scripts/selftest-gold-wall-r5-interactions.mjs` PASS; `node deploy/scripts/selftest-gold-wall-close-session-http.mjs` PASS.
- Source staging: `stage-client-core.mjs` and `selftest-packaged-local-wall.mjs` PASS (124 files).
- Rendered Settings inline JavaScript validated through Node vm.Script.
- Historical `selftest-v09-local-wall.mjs` expects pre-R5 Cascadia typography and fails against existing Google Sans; not a new log regression.
- GoldABV2 Lab has not been redeployed from this new code branch; live Local Wall still runs prior R5 source until release acceptance.
