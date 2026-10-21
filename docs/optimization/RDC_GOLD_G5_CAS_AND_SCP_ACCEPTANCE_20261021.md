# Gold G5 — Surgical edit optimistic CAS + existing SCP resume / inline progress
Date 2026-10-21. Gold branch only; production untouched.

## Implementation
The existing native `editBlock` performed read→replace→write-temp→rename. `expectedReplacements` alone does not detect when another editor modifies unrelated lines after the Agent read the file. Gold now supports an **optional expectedSha256** argument to the existing `light_remote_edit_file` schema and forwards it through the original authorized filesystem operation. It rejects stale hashes with HTTP 409 `filesystem_edit_conflict`, invalid hashes with HTTP 400, and rechecks the original content before atomic rename; temporary files are removed on both failure and success. Authorized read/write roots and local final-deny are unchanged. Legacy calls lacking expectedSha256 still work.

Error classifier maps conflict to `filesystem_conflict`, `retryable:false`, `nextAction:reread_and_confirm_expected_sha`. This is **best-effort optimistic CAS**, NOT an atomic transaction against non-cooperating external writers: the final read→rename window remains vulnerable, so do not claim universal race freedom.

## Actual source acceptance
- `selftest-g5-native-fs-cas.mjs`: stale SHA=409 without overwrite; fresh SHA edit PASS; invalid hash and temporary-file cleanup PASS.
- `selftest-v10-native-fs.mjs`: existing UTF-8/legacy editing PASS.
- SCP tests PASS: upload and download resume/integrity/source change, owner isolation, SHA plugin forwarding, crash replay guard, inline progress per job 0/50/75/100 and SHA commit. Real Gold SCP upload/download 256 KiB with correct hashes was already accepted in [previous G5 handoff](./RDC_GOLD_G5_SCP_INLINE_OPERATOR_STREAM_20261019.md). Do not retest gratuitously.
- Owner-authenticated NetBird Wall visual acceptance and explicit new CAS parameter through a refreshed external MCP schema remain pending. Never use an alternate tool to bypass a denied structured operation.

## Pending
Commit scoped files, Gold-only stage+backup+cutover with strict admission ON and rollback, verify health, then G6. Production not touched. Four unrelated untracked UAT files stay untouched.
