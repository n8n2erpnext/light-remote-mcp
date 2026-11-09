# Light Remote MCP

Internal Windows test candidate **0.10.1-dev.3** has one primary **LightRemote.exe** and a functional **Light Remote Desktop** connected to the verified local Agent. Display naming is **A/B**. Node, RM V2, private .NET DLLs and independent update/recovery helpers remain supporting components.

Exact compiled source `2771f47080bdf21913371126bcefd2923b12d257` passed [full CI #41:9/9](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42583094615). [Internal Actions artifact](https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/42583094615/artifacts/13659545229) · [acceptance and source/hash evidence](docs/evidence/desktop-backend/ACCEPTANCE.json). Installer SHA-256: `f089a2cd66a4e0a05d10aa274a189be4f71f42c82185f7847d2c92648808e57a`. **Internal testing only. No public binary release or update-feed promotion.** Existing incompatible helpers take the [pinned compatibility bridge](config/windows-core-migration.json) before the primary installer.

Desktop now reads and controls actual Memory modules/scopes/sync, Codex tasks/runtime/login, local sessions/jobs, Agent/Cloud and activity-log settings. Native Owner/account/device binding, CAS and async response fences remain enforced. Both real signed Wall B and Account B pass; wrong B returns a known400 rejection. Authenticated Owner reads and pagination are enabled on the internal A/B Lab Operator and Plugin from the same GitHub commit. Its database, identities/grants and independent Agent/Wall/supervisor/transport remain preserved.

Validation: **115 React tests**, browser/layout checks, **25 real private backend checks**, Windows installed GUI/private CLR/explicit Start/restart and full real bridge/reinstall/rollback/watchdog/uninstall. Owner physical acceptance after installing this exact candidate remains **NOT_RUN**; the currently installed Owner app was not changed. Source/build CI is distinguished from deployment and physical acceptance.

Start with [Project Truth](PROJECT_TRUTH.md), [Master Checkpoint](MASTER_CHECKPOINT.json), [Handoff](PROJECT_HANDOFF.md), [Feature Status](FEATURE_STATUS_MATRIX.md), [Known issues](KNOWN_ISSUES.md) and [Build/Deployment](BUILD_AND_DEPLOYMENT.md). Historical ARM sources and the archived repository remain recovery references; new work/builds use exact commits here.

## GitHub source authority — VPS-ARM SSH

The **official** repository is `n8n2erpnext/light-remote-mcp`. The exact Git-over-SSH remote for fetch and push is:

```text
git@github.com:n8n2erpnext/light-remote-mcp.git
```

GitHub read/write access for this project is already configured through **SSH on VPS-ARM**. On 2026-11-08, `ssh -T git@github.com` authenticated as `thdangduy/thaiduy.digital` and `git remote -v` confirmed the above origin. Use this SSH remote on VPS-ARM for fetch, pull and push. **A GitHub app/connector 403 does not mean Git-over-SSH lacks permission.** Verify the configured VPS-ARM Git SSH identity before reporting no access; do not create or expose credentials.

### Owner-controlled branch policy (mandatory)

- **Owner-approved exception (2026-11-08): `work` is the single permanent development/CI branch**, created once from existing local `main` at commit `047c744`. Keep `main` as stable baseline. Continue feature development, task checkpointing and GitHub CI on `work`, then fast-forward the verified source to `main` under its existing required check. Do not delete/recreate `work` or invent more branches. **Any additional branch requires a fresh explicit Owner request/approval.**
- Before substantive development take a **full checkpoint** (including annotated tag), then continue on `work`. Maintain only `MASTER_CHECKPOINT.json` and the established Project Book/Worklog; use controlled revert/rollback to the checkpoint if changes fail, with separate DB/runtime recovery as needed.
- `main` is protected by `baseline-required`. This explicitly approved `work` branch runs the same CI. Only promote a verified commit from `work` to `main` after the required check PASS and without force-push. If GitHub rejects promotion, preserve work and report the specific block; do not create any additional branch or relax protection.
- Historical VPS-ARM worktrees and `light-remote-mcp-archive-20261108` remain comparison/recovery references, never alternative current build sources.

### VPS-ARM workspace boundary — mandatory

**All new directories created for Light Remote development on VPS-ARM must be inside:**

`/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/`

This is the only approved **parent workspace**. New clones, worktrees (only if the Owner separately approves a branch), source checkouts, experiments, build directories, CI staging, caches, test fixtures, temporary project directories, recovery snapshots and development documentation directories must be created at or **under that parent**, never next to it.

- **Allowed:** `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/my-new-project-dir/` or any deeper child path.
- **Current development checkout:** `/home/ubuntu/n8n2erpnext/light-remote-unified-20261108/implementation-20261108/single-primary-exe/`, permanent branch `work`. The original conversion/publication checkout is a historical source reference.
- **Forbidden:** `/home/ubuntu/n8n2erpnext/new-light-remote-folder/`, `/home/ubuntu/n8n2erpnext/light-remote-mcp-new/`, or any new Light Remote project directory outside the approved parent.
- Before creating a directory, verify its intended canonical/resolved path lies under the approved parent; do not escape through `..` or symlinks. Do not use the existing repository archive, old sibling worktrees, or runtime trees as scratch space.
- Pre-existing folders outside this parent are **historical references**, not permission to create more or change/delete them. If a necessary project directory cannot fit inside this parent, stop and ask the Owner before creating it elsewhere. No implicit exceptions for an Agent or Codex.

This directory rule is independent of the **no-new-branch-without-Owner-approval** rule above.

### TASK COMPLETION AND SUBTASK CHECKPOINTS — mandatory

**Do not finish a task without a current handoff and checkpoint.** Continue using the **single** `PROJECT_HANDOFF.md` and `MASTER_CHECKPOINT.json`; record each completed task's durable milestone in `docs/project-book/LIGHT_REMOTE_WORKLOG.md`. Do not make new per-session HANDOFF_FINAL/LATEST files or additional active checkpoints.

- **Before** substantive implementation: read the current handoff/checkpoint and capture the verified pre-change Full Checkpoint/tag as already required.
- **After each completed task**, regardless of whether it changes code, runtime, configuration, documentation, or only discovers a blocker: update the same handoff and checkpoint, with exact completion/blocked status, changed files/commits, build or test evidence **and scope**, what remains unverified, issues and the **single actionable next step**.
- For a **long-running task with multiple smaller steps**, write a checkpoint + concise rolling handoff entry after **each completed meaningful step**, before beginning the next; preserve which steps are DONE, IN_PROGRESS, BLOCKED, FAILED or NOT_TESTED and which baseline is still stable. Do not postpone all documentation until the end.
- At **task finish or handover/session interruption**, reconcile handoff, checkpoint and Worklog with the actual Git tree and deployed runtime. If working locally without successful GitHub push, explicitly record `LOCAL_ONLY / GITHUB_NOT_SYNCED` and the reason. Do not claim unpushed work is published, or CI tests as physical acceptance.
- A checkpoint is a state record, not authority to create a branch, a new directory outside the approved parent, or bypass `baseline-required`.

See [Project Handoff](PROJECT_HANDOFF.md), [Master Checkpoint](MASTER_CHECKPOINT.json) and [Worklog](docs/project-book/LIGHT_REMOTE_WORKLOG.md).

See [Agent rules](AGENTS.md), [Project Book rules](docs/project-book/LIBRARY_RULES.md) and [Master Checkpoint](MASTER_CHECKPOINT.json).


## Atomic commit gate — code, checkpoint, handoff and docs together

**Every commit**, including documentation-only milestones, must contain changes to **all** of the following in the **same commit**:

- `MASTER_CHECKPOINT.json` — current state and a new `commitSyncGate.taskId`, status, summary, verification, next action, and Git-staged source digest.
- `PROJECT_HANDOFF.md` — append matching `## Task Receipt: <taskId>` with `Status:`, `Source:`, `Verification:`, `Next:` lines.
- `docs/project-book/LIGHT_REMOTE_WORKLOG.md` — append `Receipt: <taskId>` and meaningful milestone.
- `docs/project-book/PROJECT_TRUTH_STATUS.json` — regenerated from the checkpoint, staged alongside it.
- **Relevant docs if source boundaries change**: Code Map for operator/plugin/agent/native/security/SQL changes; API Integration Matrix for API contract/endpoints; build/deployment documentation for installer/build changes.

Stage code, handoff and Worklog with `git add`. Set task receipt in `MASTER_CHECKPOINT.json`, then run:

    npm run stamp:checkpoint
    npm run docs:refresh
    git add MASTER_CHECKPOINT.json PROJECT_HANDOFF.md docs/project-book/ PROJECT_TRUTH.md
    npm run check:truth
    npm run check:docs
    npm run check:commit-sync
    git commit -m "Task summary"

Local `.githooks/pre-commit` rejects missing/stale staged artifacts; **GitHub CI checks every commit**, not only final tree. Error states **YÊU CẦU BỔ SUNG CHECKPOINT + HANDOFF + DOCS (NẾU CÓ)**. No commit-code-first/commit-docs-later sequence. A local hook can technically be skipped, but CI remains authoritative on protected `main`. No new branches without Owner permission.

**Approved development flow:** `work` → same-commit checkpoint/handoff/docs gate → CI `baseline-required` → verified promotion to protected `main`. The `work` branch remains active for future development, rather than being deleted after this one-time CI bootstrap.
