# Gold G2 — POSIX managed process natural-parent-exit orphan (Linux RED→GREEN)
Date: 2026-10-20 | Branch: feature/light-remote-gold-rebuild-20261018 | G2 IN PROGRESS

## RED (verified on VPS-ARM Gold worktree, not assumed)
- Used official Light Remote authorized session to run an ephemeral NativeProcessRegistry Bash fixture. The managed shell executed `sleep 40 & child=$!; echo G2_NATURAL_LINUX_CHILD=$child; exit 0`.
- Registry showed parent `state=finished`, `finishedAt` set, exitCode 0, but independent /proc lookup confirmed background child PID **1522339 still alive** after parent exit.
- The detached process group was cleaned in fixture `finally` by signaling the exact owned PGID; no production or Gold LXD unit changed. This reproduces on Linux the same G2 natural-parent-exit orphan class previously found on Windows.

## Small POSIX process-group fix
- `lib/native-process.mjs` already launched POSIX managed jobs with detached:true and tracked the dedicated PGID. In the authoritative child exit handler, if the job has a dedicated processGroupId, the runtime now signals `SIGKILL` to that **owned negative PGID** immediately. This reaps any remaining descendants in the job group even if their parent naturally exited.
- Signal is issued on the dedicated group only, never by enumerating unrelated host processes. `ESRCH` is normal when the group is empty. Other errors produce a bounded `process_group_cleanup_failed` event with owner/job and sanitized code.
- `groupCleanup` in job view is `sent`, `empty` or `failed`, not a false assertion that all descendants were independently confirmed absent. `exitCode` and parent `finished` semantics remain accurate.
- Operational semantic note: a background child intentionally launched without leaving its process group cannot outlive a completed managed NativeProcess. Long-running workloads must be managed as their own job/process, not a daemon orphan.

## Automated regression and evidence
- New `deploy/scripts/selftest-g2-posix-natural-exit-reap.mjs`: spawns real Bash parent, verifies natural successful exit, asserts `groupCleanup=sent`, independently checks real background child dead, guarded group cleanup in finally. Linux ARM regression `G2_POSIX_NATURAL_PARENT_EXIT_NO_ORPHAN=PASS` and `G2_POSIX_GROUP_REAP_EVIDENCE=PASS`.
- Prior Linux regressions also PASS: `selftest-g2-process-child-tree.mjs`, `selftest-g2-process-stop-escalation.mjs`, `selftest-g2-runtime-shutdown-cleanup.mjs`, `selftest-v10-native-process.mjs`, `selftest-g2-lifecycle-edge-cases.mjs`.
- Linux x64/ARM64 CI now invokes the new test in Package contract smoke and watches test-file path. Windows CI also runs on the shared native-process module change; **hosted CI results pending until the Gold push**.
- macOS owner-device testing deferred by owner; this POSIX branch logically also runs on Darwin but no owner-machine E2E claimed.

## Remaining gate and boundaries
- Windows G2 per-job Job Object hosted build #441 PASS; Gold owner Windows #441 installed acceptance still pending. Previous installed #437 stop/timeout PASS but natural exit RED.
- Controlled Windows session hold/resume/cancel PASS. Abrupt physical network loss and macOS owner-device E2E remain OPEN. G2 overall not closed, G3 not started.
- No production deployment, Gold service mutation, installed owner client overwrite, policy/permission changes, or edits to unrelated UAT fixtures.

## Final Gold acceptance and CI, 2026-10-20
- Source commit: `2178797b10abeaa7543fbc837441e5712c74764b` (Linux managed process group cleanup); no production source merge.
- Linux Client Packages [Actions #279](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39385982812) **SUCCESS** x64/arm64. Read both job logs: `G2_POSIX_NATURAL_PARENT_EXIT_NO_ORPHAN=PASS` and `G2_POSIX_GROUP_REAP_EVIDENCE=PASS` on each architecture, packages uploaded.
- Windows Tray Client [Actions #442](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39385982777) **SUCCESS** at same SHA; real hosted job log verifies Windows Job Object natural exit no-orphan, nested-job, stdin/stdout, stop/timeout/shutdown 6/6 PASS. Full and compact install/uninstall/rollback passed. SHA-scoped Windows artifact `light-remote-windows-x64-2178797b10abeaa7543fbc837441e5712c74764b` uploaded, not production.
- Deployed only `lib/native-process.mjs` to isolated LXD `light-remote-gold-uat` path `/opt/light-remote-gold-uat/lib/native-process.mjs`; backed up previous module at `/opt/light-remote-gold-uat/lib/native-process.mjs.pre-g2-posix-reap-20261020`. Staged new regression script to container `deploy/scripts/selftest-g2-posix-natural-exit-reap.mjs`; executed it under unprivileged service user `gold-uat`, actual process test PASS. Source and installed module SHA-256 both `45fb6692fffff490165f189112001bfc9ba501ee37c82a2e3e9347482606b584`.
- Restarted ONLY isolated Gold `light-remote-gold-wall` and `light-remote-gold-operator` to load new module; both returned active/running. Post-restart **5/5 Gold services active** (PostgreSQL, Redis, Operator, Plugin, Wall). `https://gold.light-remote.thaiduy.digital/account` HTTP 200; Gold NetBird Wall `http://100.94.184.141:5591/` HTTP 303 login (expected). Production `https://light-remote.thaiduy.digital/` HTTP 200 and never touched.
- Rollback if needed: restore backup module within Gold LXD only, preserve root/user owner as appropriate, restart isolated Gold wall/operator; do not change production.
- **G2 still OPEN** for owner-installed Windows newest Gold build natural-exit E2E, abrupt physical transport failure/reconnect, and macOS owner-device testing deferred at owner's request. G6 performance/soak remains separate; do not misrepresent hosted CI as live owner-device acceptance.
