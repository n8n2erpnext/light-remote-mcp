# Gold branch code audit and Wall-owned dialogs — 2026-10-26

## Scope

- Source branch: `feature/gold-memory-completion-20261026`.
- Review base: `feature/light-remote-gold-rebuild-20261018`.
- Feature commit reviewed: `f4a060798b9f0eceac02b626af17fd02a43e4023`.
- **No production merge or deployment is authorized by this report.**

## Verified source audit

- At inspection time: 1,006 tracked files, 551 JavaScript source files, and 133 branch-difference files before the Wall dialog patch.
- A `node --check` sweep of the 551 JavaScript files reported **no syntax errors**. This is *not* comprehensive behavioral or security proof.
- Simple static import/orphan heuristic produced five candidate modules: `lib/gold-db.mjs`, `lib/gold-device-resource-locks.mjs`, `lib/gold-registry-persistence.mjs`, `device-agent/linux-service-policy.mjs`, `operator-host/executor.mjs`. Follow-up found runtime/entrypoint/packaging references. **None was removed without demonstrated dead-code status.**
- Five initial relative-import warnings came from test strings/assertions rather than actual broken imports.
- Windows core bundle import-closure self-test passed.

## Confirmed UI defect and correction

- The original Gold Local Wall had `confirmOverlay`, yet 22 Memory/Codex actions used native browser `confirm()` or `prompt()`.
- They now invoke the app-owned Wall modal with typed input, Escape/Cancel/Confirm, focus management and the existing destructive-action validation retained.
- Gold secondary Fleet Jobs, Processes and Device Update pages now render a shared app-owned dialog from `lib/wall-dialogs.mjs`. This module is included in `client/core-files.json`.
- New portable static/rendered output regression: `selftest-gold-no-native-browser-dialogs.mjs`; Chromium fixture: `selftest-gold-wall-dialogs.mjs`.
- Account/Admin Portal still has 21 native browser dialog calls and the landing page another 4; not fixed in the Gold Local Wall patch. Those are future Web Distribution/Admin work.

## Local regression results (PASS)

- `selftest-gold-no-native-browser-dialogs.mjs`
- `selftest-gold-wall-dialogs.mjs` (Chromium; isolated fixture)
- `selftest-gold-wall-navigation.mjs`
- `selftest-gold-memory-scope-management.mjs`
- `selftest-gold-memory-account-delete.mjs`
- `selftest-gold-codex-task-management.mjs`
- `selftest-gold-codex-supervisor.mjs`
- `selftest-gold-codex-coordinator.mjs`
- `selftest-gold-client-core-imports.mjs`
- `git diff --check`

## CI and deploy boundary

For feature commit `f4a0607`, GitHub Actions Gold G3 Operator regression (run 40299793792) and Windows native-client build/install smoke (run 40299793784) both succeeded.

A snapshot `gold-before-ui-dialogs-f4a0607-20261026` was taken and source candidate staged in the isolated `light-remote-gold-uat` LXD. Candidate self-tests passed. A subsequent cutover attempt was blocked by device safety policy; last verified effective running commit was `371f1ce7`, with four services active. Do not claim the new dialog patch is deployed until cutover is independently confirmed.

Creating a GitHub PR requires the GitHub web/API permission; successful `git@github.com` SSH push does not create PR objects. As of this report, there is **no PR** for this branch. Compare link:
https://github.com/n8n2erpnext/light-remote-mcp/compare/feature/light-remote-gold-rebuild-20261018...feature/gold-memory-completion-20261026

## Outstanding release gates

1. Create and review PR, protecting the separate Gold UAT base from production changes.
2. Cutover and verify the dialog patch on UAT using approved tools/permissions.
3. Windows owner-install verification for any newly packaged client.
4. Deeper authorization, concurrent job/reconnect, signed Memory tombstones/offline ACK, and update-distribution integrity audits.
5. Normalize remaining portal dialogs and design Web Distribution + Admin only after Gold baseline acceptance.

This document is a scoped first-pass audit with explicit unresolved items, **not** a certification that all source code is free of defects.

## PR #4 review finding and parity remediation

PR [#4](https://github.com/n8n2erpnext/light-remote-mcp/pull/4) is open and mergeable, but its initial Gold Native Wall Modules Parity job (40301835007) failed because the #486 frozen-client guard also hashes three intentionally changed files outside the original three allowed dynamic files. This is a **real failing merge gate**, not a compiler error or a GitHub permission failure.

- `device-agent/local-process-page.mjs`: owner-confirmation uses the in-Wall modal instead of native Chrome confirm.
- `device-agent/update-settings-page.mjs`: existing owner-guarded local Memory deletion UI and in-Wall modal. This page still intentionally refuses all-account deletion; it is **not** the separate scoped Home-signed delete workflow.
- `device-agent/wall-status-cache.mjs`: generation fencing and cache invalidation after closing a session, preventing stale hold state from reappearing.

The parity guard now contains SHA-256 pins for **only those three exact files**. It still requires the frozen #486 baseline files to exist, checks the entire staged package manifest, and rejects every other mismatch; `exact` mode remains unchanged. No wildcard directory allowlist or disabled checks. A future change to any pinned file requires explicit review and an updated digest.

Local PR validation: `verify-gold-core-parity.mjs /tmp/gold-pr4-core-audit extension` PASS, 90 frozen files matched against 110 staged package entries; `selftest-gold-wall-close-session-cache.mjs <repo>` PASS, and the full Gold Native Wall Modules Parity command sequence, including packaged Wall HTTP smoke, PASS on VPS-ARM. This is separate from final GitHub CI status and UAT cutover.
