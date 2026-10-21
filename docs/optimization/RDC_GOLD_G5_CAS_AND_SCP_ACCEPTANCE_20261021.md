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

## Live Gold UAT deployment (2026-10-21)
- Immutable source **`0210cabb4a7dbd9ed839ff97a25dcb83b1894ed4`** was already staged, so the staging script correctly refused to overwrite it (`G3_GOLD_RELEASE_ALREADY_STAGED`). Independently verified `.git-source-sha`, package-dependency linking and SHA256 parity against branch HEAD for `lib/native-fs.mjs`, `plugin-server/tools.mjs` and G6 soak code. Candidate-local CAS regression PASS.
- Gold Fleet preflight strict ON, 2/2 ready/fresh, **zero active sessions/queued/inflight**; backup code/systemd/local-state/PostgreSQL dump PASS. Protected Gold-only cutover `G3_GOLD_CANDIDATE_CUTOVER=PASS`, 10 consecutive health samples PASS; strict ON and rollback override retained. Gold 5/5 services active, Fleet 2/2 ready/fresh, inline ON, HTTPS Gold 200; production only read-only HTTP 200.
- Subsequent review uncovered an MCP presentation issue: known `filesystem_edit_conflict` (409, retryable:false) was still tagged `isError:true`, causing client-side opaque `INVALID_ARGUMENT`. Small scoped patch treats **only** the complete known conflict decision (not unknown or OAuth faults) as a normal structured nonretryable negative result. Regression `selftest-gold-tool-error-origin.mjs` PASS. A follow-up Gold candidate cutover must be confirmed separately.
- **Limitation:** this chat's connected Gold MCP tool schema still lacks `expectedSha256` even though plugin source now supports the optional prop. No claim of actual ChatGPT MCP CAS parameter E2E until Gold plugin schema refresh and owner test. Source/Candidate real Gold LXD FS fixture validates guard without bypassing policy.
- Existing real Gold SCP 256 KiB transfer previously PASS; owner Wall visual review remains pending.

## Pending owner release acceptance
External connector schema exposure, physical Gold Client macOS/Windows edit-guard packaging, authenticated Wall visual test and long soak. Preserve production boundary and four unrelated untracked UAT files.
