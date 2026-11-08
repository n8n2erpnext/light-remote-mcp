# Project handoff — clean Light Remote MCP repository

Read PROJECT_TRUTH.md and MASTER_CHECKPOINT.json first. The official repository URL is unchanged but its repository ID is new: 1450214328. Its history starts with a fresh parentless initial commit. Do not fetch/push from the preserved ARM historical worktrees to this new repository: those unrelated histories exist only for comparison/recovery.

The old repository is [n8n2erpnext/light-remote-mcp-archive-20261108](https://github.com/n8n2erpnext/light-remote-mcp-archive-20261108), ID 1361698660. The available legitimate GitHub credential has repo/workflow administration but no delete_repo scope, so the old repository was renamed and a genuinely new repository created at the official URL. This is not a force-push replacement. Keep old sources, archives and live runtimes unchanged.

This source is an independent export of ARM audited snapshot b250908, with product inputs matching preconversion verified build eb6b2e6. Existing 8/8 CI and Windows installer receipts are historical; the new initial commit needs fresh CI and artifact verification. All new builds/deployments must identify a commit in the new repository, never a STAGED source or old worktree.

Current CI requires no repository/environment secrets. Historical environment settings and permissions are backed up privately on ARM; do not copy old deployment automation, production credentials, webhooks or inactive environments into the baseline. Reintroduce a secret only from an authorized source when an active workflow needs it.

After fresh CI succeeds, clone/fetch from this GitHub repository into a separate new candidate directory and run the defined integration scope. Preserve old runtime for rollback; no production cutover is authorized here. Native GUI acceptance/new-backend routing, local Agent/browser SSO wiring, signed B-command acceptance and the future single primary Windows EXE remain explicitly incomplete in KNOWN_ISSUES.md.
