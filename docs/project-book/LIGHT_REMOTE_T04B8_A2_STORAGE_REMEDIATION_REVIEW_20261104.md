# T04b8-A2 — GoldABV2 Lab storage pressure and rollback readiness

Date: 2026-11-04 ICT. **READ-ONLY REVIEW / NO DELETION / NO CUTOVER APPROVAL.**

## Observed live VPS-ARM baseline

- System root is ext4, `/dev/sda1`. `df` reports 128,891,142,144 bytes total, ~112,984,371,200 bytes used, ~15,889,993,728 bytes available. Roughly **87.7% used**, **14.8 GiB free**. Policy is **<=85% used** and **>=10 GiB free**, so reclaim approximately **3.2 GiB more real root space** before even considering a new snapshot.
- LXD storage pool `default` is `btrfs` backed by a 40 GiB file-based pool, **33.33 GiB used / 6.67 GiB free (83.3% used)**. The separate pool gate requires **>=5 GiB free and <=90% used**; this currently PASSES, but a fresh snapshot can increase usage. Storage pool is shared with `erpnext`, `light-remote-direct`, `light-remote-gold-uat`, and other instances. Do not alter its size/config or purge snapshots based on this inventory.
- The isolated `light-remote-abv2-lab-20261101` has **31 historical snapshots**. No snapshot is recent enough for the 2-hour pre-cutover safety window. The prior rollback script's 3 scoped backup files passed SHA-256 checks; `--check` proves both Plugin and Operator overrides are NOT applied.
- `lr-t04b8-a2-source-autooff-20261104.timer` and its matching `.service` are `not-found`; the timer is not active/scheduled and does not demonstrate any live rollback capability. A future independently scheduled timer must be bound to the actual backup rollback script before readiness can PASS.
- Lab services 4/4 active, public HTTPS health200 and TLS verification0. No migration, source activation, SSO or Traefik switch has been performed.

## Non-destructive directory inventory (estimates only)

| Host path / group | Read-only observed size | Preservation / action |
|---|---:|---|
| `/home/ubuntu/light-remote-backups` | ~3.6 GiB | **PRESERVE**: includes October RC build+releases and Gold continuity backups; needs per-release retention owner review and verification of off-host copies before deleting anything |
| `/home/ubuntu/backups` | ~1.5 GiB | **PRESERVE**: historical sentinel checkpoint, cannot call obsolete |
| `/home/ubuntu/light-remote-release-staging` | ~1.0 GiB | **REVIEW**: might be used for active release; confirm no process, service, CI or rollback reference |
| `/home/ubuntu/.cache` | ~691 MiB | **REVIEW**: cache scope/application ownership; do not clear blindly |
| `/home/ubuntu/.npm` | ~386 MiB | **REVIEW**: package cache; requires healthy registry/network before removal |
| `/home/ubuntu/.vscode-server` | ~631 MiB | **PRESERVE until verified**: may serve active remote editor |
| `/home/ubuntu/.rustup` | ~1.5 GiB | **PRESERVE**: compilation toolchain |
| `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees` | ~1.4 GiB | **PRESERVE**: both active Git project trees |

The sizes above are **du estimates, not guaranteed reclaimable bytes**. Ordinary `du` cannot inspect every root-owned directory or LXD mount, so it is not a complete accounting of the `df` total. A future approved storage operation must check real `df` results after each reversible step and maintain backup integrity.

## Release safeguards implemented in source

- `deploy/scripts/gold-abv2-lab-rollback-readiness.mjs --audit` is read-only. In addition to prior 3-file backup hash, both-service override check, fresh snapshot, independent timer, baseline Plugin/Operator, four services, HTTPS/TLS, host disk policy, it now checks **LXD pool headroom** and verifies that the timer's Unit points to the intended `.service` whose ExecStart actually calls the **specified rollback script**, not a harmless `--check` or unrelated service.
- `deploy/scripts/selftest-gold-abv2-lab-rollback-readiness.mjs` now tests negative wrong timer target, pool below 5 GiB and pool above 90% usage.
- Actual Lab `--audit`: expected BLOCKED exit3 (fresh snapshot missing; timer missing/not bound; host disk over85%); backup, baseline, public TLS, and LXD pool pass. **canCutover=false** even if future technical readiness passes. Source Gate CI to be verified on next commit.

## Ordered plan — no approval assumed

1. Separately approve **isolated GoldABV2 Lab-only compatibility artifact**, not Gold UAT or production release. Canonical Git lock remains 042; 043/045 were historically Lab-only; Guest044 HOLD; SSO OFF.
2. Audit release retention, process references and verified external backups. Make a scoped preservation-and-cleanup proposal listing exact bytes/paths; request owner approval before any irreversible deletion or movement.
3. Confirm safe root headroom via `df` (<=85% used and >=10GiB free), LXD pool >=5GiB free and <=90% used.
4. Immediately before authorized Lab-only cutover: create fresh scoped snapshot and backup, arm and inspect a properly bound independent auto-off rollback unit, rerun **source compatibility review AND rollback readiness audit**, and only then evaluate time-bounded source switch, readiness observation and rollback criteria. No mTLS/Owner/Redis/Ed25519 or native Windows SSO acceptance has been proven by these preparatory checks.

**No action in this review authorizes deletion, SQL apply, service restart, mTLS changes or SSO enablement.**
