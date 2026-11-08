# Light Remote MCP

Fresh development repository, ID1450214328. Version **0.10.0-dev.1**, profile goldabv2-desktop-v4. Verified build `c03b50f`: [CI9/9 PASS](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42475715858) and21/21 isolated ARM integration checks from a new GitHub clone.

Start with [Project Truth](PROJECT_TRUTH.md), [Master Checkpoint](MASTER_CHECKPOINT.json), [Handoff](PROJECT_HANDOFF.md), [Owner report](OWNER_REPORT.vi.md), [Feature Status](FEATURE_STATUS_MATRIX.md), and [Build/Deployment](BUILD_AND_DEPLOYMENT.md). [Historical repository](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108) and old ARM sources are preserved reference archives. New builds come from identified commits in this repository.

This is a development baseline. [Known issues](KNOWN_ISSUES.md) separate unfinished features and physical/native acceptance from automated proof. No public update-feed promotion or production runtime cutover occurred.

## GitHub source authority — VPS-ARM SSH

The **official** repository is `n8n2erpnext/light-remote-mcp`. The exact Git-over-SSH remote for fetch and push is:

```text
git@github.com:n8n2erpnext/light-remote-mcp.git
```

GitHub read/write access for this project is already configured through **SSH on VPS-ARM**. On 2026-11-08, `ssh -T git@github.com` authenticated as `thdangduy/thaiduy.digital` and `git remote -v` confirmed the above origin. Use this SSH remote on VPS-ARM for fetch, pull and push. **A GitHub app/connector 403 does not mean Git-over-SSH lacks permission.** Verify the configured VPS-ARM Git SSH identity before reporting no access; do not create or expose credentials.

### Owner-controlled branch policy (mandatory)

- Work on the existing **`main`** branch only. **Never create a branch, temporary CI/PR branch, `codex/*` branch or branch-backed worktree without the Owner's explicit prior request or permission.** A failed push, a test failure or technical convenience does not authorize branching.
- Before substantive development take a **full checkpoint** (including annotated tag), then continue on `main`. Maintain only `MASTER_CHECKPOINT.json` and the established Project Book/Worklog; use controlled revert/rollback to the checkpoint if changes fail, with separate DB/runtime recovery as needed.
- `main` is protected by GitHub Actions `baseline-required`. **If direct push is rejected, preserve the local commit and report the block. Do not create a workaround branch, relax protection or force-push without prior Owner permission.**
- Historical VPS-ARM worktrees and `light-remote-mcp-archive-20261108` remain comparison/recovery references, never alternative current build sources.

See [Agent rules](AGENTS.md), [Project Book rules](docs/project-book/LIBRARY_RULES.md) and [Master Checkpoint](MASTER_CHECKPOINT.json).
