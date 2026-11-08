# Gold M4 — Background process resource lease

Date: 2026-10-21. Baseline: [M4 Resource Locks](./RDC_GOLD_M4_RESOURCE_LOCKS_20261021.md); [M5 Isolated Worker](./RDC_GOLD_M5_ISOLATED_SYSTEMD_WORKER_20261021.md).

Migration **034** adds `process_id`, `worker_state` and launch time to the typed relational `lr_gold_device_resource_claims` table. A signed `process:start` launch receipt releases the personal Agent slot but retains the device/project/worker claim for a still-running `lp_...` process. No launch ACK means `terminal_unknown` and the claim stays held, never blindly retried. Signed, account/device-bound terminal results alone can release the matching claim.

Device Agent now collects a bounded list of terminal M5/NativeProcess receipts without scripts, paths or output and sends these via existing signed poll/pulse/duplex heartbeat channels. Operator verifies the channel binding and process identity before freeing the claim and resuming device waiters. A signed owner `process:output/stop/list` terminal receipt is also a valid reconciliation trigger. `running/stopping/UNKNOWN` does not release.

**Security scope:** feature flag `OPERATOR_DEVICE_RESOURCE_LOCKS` on Gold UAT only; Pro Team cross-account remains OFF. No production or installed client changes. Resource intent uses lexical paths and does not guarantee symlink/junction aliases. Terminal/SCP lifecycle leases, cgroup CPU/RAM enforcement, desktop pointer lock, user-facing reconciliation and reboot-resume remain separate gates.

**Tests required:** verify migration034 checksum and installer, real PostgreSQL fixture (retained lock after launch, other project admitted, same project queued, worker budget, authenticated finish release, unknown fail-closed), signed UAT Linux process heartbeat and no drain, CI, full backup, rollback.

**Rollback:** inspect active workers first, disable M4 UAT-only feature flag, preserve PostgreSQL 034 and UNKNOWN claims. Do not downgrade to a binary demanding schema033 without planned DB restoration.

## Physical acceptance — Gold LXD 2026-10-21

**Immutable source:** `5c805807aa03f3d1769c552f1a9fe6730cb4248d`, branch `feature/light-remote-gold-rebuild-20261018`.

- Gold UAT preflight: strict ON; two leaves ready, `drain=false`, queued/inflight/sessions = 0; 6/6 system services active; no user-systemd worker left running. Candidate source staged with package-lock parity PASS and live services untouched.
- Verified independent backup `/var/backups/light-remote-gold-uat/pre-g3-5c805807aa03f3d1769c552f1a9fe6730cb4248d/` (source/systemd/local state/PostgreSQL dump). Separate restricted migrator applied SQL **034**, versions 1–33 pre-existing.
- Real PostgreSQL fixture `selftest-gold-m4-worker-lease-pg.mjs` as unprivileged `gold-uat` with genuine application database credentials **4/4 PASS**:
  - `M4_BACKGROUND_LAUNCH_LOCK_PERSISTS_AGENT_SLOT_RELEASED`
  - `M4_BACKGROUND_UNKNOWN_AND_FOREIGN_OWNER_NO_RELEASE`
  - `M4_BACKGROUND_VERIFIED_EXIT_RECLAIMS_WORKER_AND_PROJECT`
  - `M4_BACKGROUND_LOST_LAUNCH_ACK_FAIL_CLOSED`
  Test accounts/device identifiers are randomized and removed without affecting real users. Release is keyed to the same account/device/process identity, never an arbitrary local OS PID.
- Guarded G3 cutover `G3_GOLD_CANDIDATE_CUTOVER=PASS`, **10/10** stable health samples, strict admission preserved. Verified both `light-remote-gold-operator` and `light-remote-gold-wall` execute source `5c80580`. Existing isolated Gold UAT flags `OPERATOR_PERSONAL_AGENT_SCHEDULER=1`, `OPERATOR_DEVICE_RESOURCE_LOCKS=1`, worker budget=2, M5 supervisor remain enabled.
- **Real Gold MCP process test #1**: native `light_remote_process` `make --version; sleep 14; printf ...` in `/tmp`, actual launch job `40f50cab-9a03-4630-953a-351de8dc2ec3`, process `lp_3_fZdswpycseYA_Zjxr5uCHY`. While running, app-only PG query: admission `finished` but claim `resource_key=project:/tmp`, `process_id=lp_...`, `worker_state=running`, `worker_weight=1`. After OS completion, query showed **no claim**. No `process_output` or `stop` was called: automated authenticated Device heartbeat reconciled it.
- **Real Gold MCP same-workspace contention test #2**: process launch job `4aea8bc6-f59a-4725-97fa-0b6846a40d82`, process `lp_ntP_yvQX9A5GundrV2H_LG64`, `make --version; sleep 26`, `cwd=/tmp`. A separate bounded short `exec` using the **same** `/tmp` workspace returned `state=queued`, job `573cb119-3d99-42f0-986a-790d8853c1a8`. During overlap direct PG query confirmed `RESOURCE_LOCKED` for the queued job and owner process claim `worker_state=running`, `resource_key=project:/tmp`. After natural process completion, both PG job rows were `finished/ok`, both resource claims absent, and the queued job's stdout was recovered: **`M4_QUEUED_EXEC_RELEASED`**. No manual lock release or process output polling occurred. This is physical evidence of **automatic signed heartbeat release and queue wake-up**, not merely SQL fixture admission.
- No temp files were created by these tests. Linux and automatically opened Windows Gold test sessions were explicitly closed. No production/installed client changes.

## CI and limits

Gold Operator CI [39630118725](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39630118725), Linux Client Packages [39630118772](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39630118772), and macOS Client Packages [39630118721](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39630118721) completed SUCCESS. Windows Tray Client [39630118852](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/39630118852) completed **SUCCESS** (`build-install-smoke`), verified after the initial CI inspection. Package builds are not evidence of installed Windows/macOS real process behavior.

**Not yet accepted:** symlink/junction canonical path + CAS, true OS CPU/memory/disk cgroups and per-account background quotas, terminal/SCP lifetime leases, exclusive shared desktop pointer input, real three distinct Pro Agents with a fourth queued, Windows/macOS *installed* device tests, Pro Team billed cross-account authorization (OFF), and reboot-resumable builds. Current receipt is **process tree terminal**, not build artifact checksum. The accepted Gold Linux process heartbeat cannot be generalized to Windows/macOS OS execution without physical tests.
