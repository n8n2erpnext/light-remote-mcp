# Agent continuity rules — Light Remote GoldABV2 × Desktop V4

**Read first:** [docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md](docs/project-book/LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md), sections 0, 8–11, 13 and newest dated receipt in section 14. Older dated Gold/desktop Master documents are historical supporting evidence; this living master is authoritative for task status.

**Mandatory after EVERY task (including partial, blocked, CI or documentation work):**
1. Truthfully update the current status and active next task in the SAME living Master, append a new top-level `## YYYY-MM-DD — Txx...` task receipt. Keep exact source SHA, tests, CI run/jobs, Lab E2E, Windows physical proof and blockers separately labelled. Do NOT invent a PASS.
2. Append `## YYYY-MM-DD ...` to `docs/project-book/LIGHT_REMOTE_WORKLOG.md`. Update `docs/project-book/LIGHT_REMOTE_CODE_MAP.md` whenever code/security/file responsibilities change. Update `.light-remote/CURRENT_CHECKPOINT.json` including `livingMasterHandoff.path`, `status` and `nextAction`.
3. Stage source + documentation atomically. On source changes run `node deploy/scripts/check-project-truth-sync.mjs --stamp` AFTER staging source, then `--staged` and `git diff --cached --check`. The guard rejects future task commits that omit the Master/Worklog/checkpoint or lack a NEW dated Master receipt.
4. Commit and push on the authorized VPS-ARM canonical worktree using SSH. Verify new GitHub CI on its exact run ID. For later CI results, append a new dated CI receipt in a separate docs-only commit.
5. **Sync the living Master byte-for-byte to BOTH** branches `feat/goldabv2-desktop-owner-lab-20261103` (canonical Gold) and `feat/desktop-v4-api-integration-20261103` (Desktop mirror), with Worklog and checkpoint updates on the mirror as well. Run `cmp -s` on the two Master files before announcing completion.
6. If an operation is blocked by safety/permission, do not bypass; report it, avoid deployment and record the exact blocker if feasible.

**Security:** Gold main UAT and production are out of scope by default. Never silently enable Owner/SSO flags, touch secrets, bypass B approval/Device Policy, assert real HTTPS from Node HTTP simulation, or call a source-only implementation live. Use GitHub Actions for native Windows/macOS/Linux builds, not VPS-ARM SSD. T04b8 is the next task unless Owner explicitly redirects.

**Worktrees:** Gold `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103`; Desktop `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101`.
