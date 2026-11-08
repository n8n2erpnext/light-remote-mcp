# Gold P0 — M4 unknown-workspace conservative conflict fix

## Verified current production-independent issue
- Gold Windows11 installer artifact staging job `1b3ff8bc-8caa-4de8-8b20-2bc371e853d4` queued as `RESOURCE_LOCKED` with the generic `filesystem:unknown` resource scope while two historical background claims are intentionally held.
- The owner has explicitly placed historical claim release on HOLD. The queued staging job was cancelled **before dispatch**, with verified `cancelled_before_dispatch`; no installer ran, no A/B bypass.
- Review of `operator-host/device-resource-intent.mjs` revealed a separate serious fail-open gap: historical `project:unknown` could falsely appear disjoint from a known `file-dir:c:/...` write. When cwd cannot be safely resolved, overlap cannot be disproven and M4 must retain an exclusive conflict.

## Minimal fix
- `resourcePathsOverlap` now treats `project:unknown` as a device-wide unknown workspace, symmetric with any other scope; `filesystem:unknown` and `device:unknown` already had this property.
- Known, disjoint project/file directory scopes still do not overlap. No device grant, memory, quota, actual claim row, or API contract is changed.
- Extended `selftest-gold-m4-resource-policy.mjs` and added `selftest-gold-m4-unknown-workspace-conflict.mjs` with real GoldDeviceResourceLocks `tryClaim` fake PG client: no insertion for unknown/known overlap, allowance for truly separate known paths. Both PASS.

## Install boundary
- Windows artifact exists in successful GitHub workflow 40720721607; full and compact installer, installed smoke and updater rollback PASS on CI. Physical installed Win11 remains its original rc49.
- Do not widen resource classifier or override historical owner-held claims merely to stage an installer. An absolute download destination alone does not justify bypassing unknown-workspace background work.
- Real Pro Team E2E remains HOLD_OWNER_RESOURCES; three historical resource claims remain HOLD_EVIDENCE_AND_OWNER_AUTH; A/B V2 deferred.
