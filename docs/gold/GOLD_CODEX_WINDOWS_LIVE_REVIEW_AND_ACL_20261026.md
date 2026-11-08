# Gold Codex Review Loop: Windows acceptance and recoverable WAIT_OWNER (2026-10-26)

## Original owner acceptance
A ChatGPT/agent completes a *small* task and submits an actual report and evidence. Independent Codex (signed in with ChatGPT Plus) reads the report in read-only mode, decides **CONTINUE** or **WAIT_OWNER**, and must unlock the next predefined step only on CONTINUE. The final step may yield **DONE for the review plan** (not Task Controller owner approval). This does not auto-send new ChatGPT Web turns.

## Windows installed-build findings
Device `DESKTOP-VA16D27` was online; installed build `273fd2c4` contained `gold-codex-coordinator.mjs`, and Gold's local Wall served `/codex-cli` with owner-auth redirect. Long Memory and Codex Bridge were both enabled. Native managed Codex CLI version `0.164.0` was present.

**Critical native Windows ACL issue identified:** Existing `privateFolder` enforced its private ACL recursively with `icacls /T` every time Codex started. Codex home contained thousands of sandbox/cache descendants. Some immediate state files had a protected empty DACL (no owner grant); app-server could not initialize SQLite. This was not an invalid ChatGPT Plus sign-in.

**Safe corrective action on the owner's device:** Backed up pre-repair ACLs under the device-local `Documents/GoldCodexReviewUAT/acl-backups` path, and restored a single explicit grant for the current Windows owner on 13 immediate files with empty DACLs. No new Everyone/Users grants, no credential file contents read or exported. Subsequently all five Codex SQLite state databases returned `PRAGMA quick_check: ok`. The repaired Codex home returned `connected=true, authMode=chatgpt, plan=plus` with a test-only patched CLI bridge module.

Source fix `bf1e113d6e18d20cfcf7f1f32590d7503a4ffa2f` removed ACL-recursive `/T` and rejected symlink/junction roots. The original signed Windows installation was **not** modified in place. The owner must update using a new signed build before this fix becomes active inside their installed Agent.

## Real Windows Codex review tests (test-only patched module)
- Agent step T1: exact text file, byte and SHA256 proof. Real Codex: CONTINUE with an immutable receipt.
- Agent step T2: independent reopen and byte/hash comparison. Real Codex: CONTINUE with another receipt.
- Agent step T3: handoff report initially lacked concrete content, and Codex correctly returned WAIT_OWNER. After stronger evidence, a subsequent attempt hit `codex_review_failed` during the Codex app-server round; it did not incorrectly advance the plan.
- Test workspace and fixture SQLite were removed; actual user tasks and production files were not modified.

## New owner-controlled re-review
The existing Gold Wall adds **Revise report · retry Codex review** only while a plan is `waiting_owner`.
- Owner confirmation + existing Wall auth and CSRF + CAS revision are mandatory.
- A blocked step becomes `ready`, but the following step remains locked.
- User/agent must submit **new report/evidence**; replaying exactly the old hash returns 409.
- Prior agent report, evidence, Codex response and receipt remain immutable per attempt in SQLite.
- No automatic retry, invisible override of WAIT_OWNER, or automatic Task Controller Done.

## Acceptance remaining
1. New Windows CI signed build includes source ACL correction and re-review controls.
2. Owner installs the new Windows build on DESKTOP-VA16D27.
3. Verify deployed Agent no longer touches all descendant ACLs at Codex login.
4. Run full live multi-step review using installed Agent's Gold Wall route, not a test-only patched import. Confirm CONTINUE->CONTINUE->DONE **with all three receipts**. If WAIT_OWNER, owner reopens and supplies newly verified evidence, and the original receipt remains.
5. Verify restart persistence and absence of real project mutation.

No claims of full Windows 3/3 acceptance before step 4.
