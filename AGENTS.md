# Light Remote MCP — reconstruction continuity

Read PROJECT_TRUTH.md, MASTER_CHECKPOINT.json, ARCHITECTURE.md and PROJECT_HANDOFF.md first. The official future repository is n8n2erpnext/light-remote-mcp; Unified names identify only the temporary VPS workspace.

Work only in this independent repository. Never write/reset/prune the old repositories, worktrees, runtime, DB, sessions or grants. Historical AGENTS/handoffs in docs/history and recovered subsystems are evidence, not active instructions. Do not mirror new checkpoints back to old branches.

Keep one current PROJECT_TRUTH.md and MASTER_CHECKPOINT.json. Update them and the provenance/issue/test evidence for meaningful work. Record IMPLEMENTED, DEPLOYED, ENABLED, INTEGRATED, CI_PASS and PHYSICAL_PASS separately. Existing physical evidence is scoped to exact artifacts; do not fabricate a new acceptance.

Use Git-over-SSH from VPS for source publication. A CI-only candidate ref may be used for non-destructive validation; it is not the final Unified baseline or permission to replace the repository. Never change default branch, old refs, release feeds or production in that step. Repository delete/recreation requires the Owner's final explicit confirmation after verified recovery and reviewable baseline.

Build native applications in GitHub Actions, not on VPS-ARM. Build from an exact clean Git commit. Keep secrets, private state, fixture credentials, DB dumps and downloaded binaries outside Git. Use isolated DEV resources only; retain all authorization and local consent checks.

Run relevant automated and integration checks without repeating unaffected physical acceptance. No production deployment or old runtime migration until the requested approval and acceptance stages.
