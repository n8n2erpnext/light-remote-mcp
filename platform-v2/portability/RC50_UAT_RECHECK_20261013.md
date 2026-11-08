# rc50 portability / synthetic UAT recheck — 2026-10-13

This checkpoint is **test evidence, not production authorization**. Linux Agent receipt-lock UAT, synthetic sealed backup and portable Compose tests only. No actual remote execution, customer state copy, production DB/billing/PTY modification, DNS switch or release.

## Accepted synthetic evidence

- `node platform-v2/portability/verify_synthetic_agent_os_lock_uat.mjs`: **PASS** (exit 0). 8 isolated processes. Kernel lock is now acquired on the **absolute receipt.lock fixture path**, not an incidental numeric path `3`. Added an independent process that separately attempts `flock` on the same real inode and must fail with the designated lock-conflict exit code. Covers SIGKILL kernel release, recovery of STARTED as UNCERTAIN, duplicate no-execution and preserved serialized fake receipts. The previous 7-process PASS was **not valid evidence of the intended inode**; see correction below.
- `node --test platform-v2/portability/test_rc50_agent_receipt_decision.mjs platform-v2/portability/test_rc50_agent_dispatch_triage.mjs`: **69/69 PASS**, exit 0.
- `python3 -B platform-v2/test/test_sealed_synthetic_backup.py`: **7/7 PASS**, exit 0. AES-256-GCM only for generated fake JSON inside temporary folders; not a real backup.
- `python3 -B platform-v2/test/test_cold_move_portability_contract.py`: **4/4 PASS**, exit 0. Static test only.

## OS-lock correction (critical)

Old UAT arguments to util-linux `flock` were `-F 3 <command>`; in this command mode, `3` was interpreted as a pathname, creating a 0-byte untracked repo file named `3`. It was verified empty/untracked and removed. The test was corrected to use the absolute temporary fixture `receipt.lock` path. The new independent inode-lock contention check prevents this false positive from recurring. The UAT runs in a private temporary working directory and rejects a numeric stray lock path. This still proves **only cooperative, advisory Linux locking in a fake fixture**, not real Agent safety nor Windows/macOS support.

## Docker two-stack cold-move: still FAIL

The previously safety-blocked synthetic rehearsal can now execute through normal Light Remote. However `python3 -B platform-v2/portability/rehearse_cold_move_uat.py --confirm-synthetic-only` **failed**, before source freeze/restore, at a newly created Redis container reporting `synthetic_container_unhealthy`. A diagnostic-only healthcheck for authentication produced `health_exit_21` (fixture password lookup empty in container). On the host, the freshly generated private Redis config did contain a `requirepass` directive and mode 0600; the container-side mount/read mismatch remains unexplained. Further diagnostic attempts did not establish an accepted fix. All edits to `compose.uat.yml` and `rehearse_cold_move_uat.py` were **reverted**; neither changed in this checkpoint.

The synthetic run printed `RC50_COLD_MOVE_SYNTHETIC_STACKS_CLEANED`. Read-only verification showed both preexisting UAT PostgreSQL/Redis containers healthy and no running `lr-uat-move-*` containers. This does not rule out every orphaned volume. No cross-stack migration acceptance can be claimed until the scratch Redis mount/configuration issue is identified and the full test passes.

## Source integration and remaining gates

- rc50 branch: `feature/rc50-mjs-scale-20261011`.
- Code baseline previously consolidated into `fecef0ceb8d62859e401676920e32bdbd220f43c`. GitHub `origin` was corrected to repository SSH URL and pushed successfully using the owner's existing authorized account key, not the read-only deploy key. Local tracking is configured; no force-push or production branch edits.
- Receipt and dispatch classifiers are offline fake-only. Real AgentReceiptAuthority, signer issuance, local OS lock integration, grant/revocation and just-before-physical-side-effect checks remain **NOT_READY**.
- Privileged PostgreSQL application role provisioning, global mutation fencing and live two-host migration are **NOT_RUN/NOT_READY**.
- The current handoff pointer in `/home/ubuntu/handoffs/LIGHT_REMOTE_MJS_HANDOFF_CURRENT.md` is stale and has a history of tool safety denial. Use the new explicit handoff in `/home/ubuntu/handoffs/LIGHT_REMOTE_RC50_SAFETY_RETEST_20261013.md` instead; do not use PTY/alternative tools to evade any future denial.

**Next:** independently identify Redis scratch Compose bind-mount target and safe authenticated healthcheck without exposing generated credentials. Validate two-stack synthetic data restoration end-to-end. Separately build actual Agent receipt authority and test native Windows/macOS locks before production wiring.
