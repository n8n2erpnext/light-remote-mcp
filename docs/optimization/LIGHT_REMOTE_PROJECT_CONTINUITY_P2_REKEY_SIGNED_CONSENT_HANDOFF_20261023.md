# Light Remote Project Continuity — P2 Signing-Key Rekey and Durable Consent Receipts

Date: 2026-10-23 (Asia/Ho_Chi_Minh)
Branch: `feature/project-continuity-plan-20261023`
Previous verified commit: `66df7371343d85de187303c67c3a9aeb2e449a1e`
Status: **SOURCE PILOT / NOT RELEASE READY**
Frozen Gold rollback branch: `checkpoint/gold-pre-project-continuity-20261023`
Frozen Gold SHA: `30766940ac18e55cb735354b40a3af9ba37eddb8`
Owner-tested Windows baseline: GitHub Actions Windows Tray Client #486, source `3076694`.

## What was completed this turn

### 1. Password rekey without loss of signing identity

`device-agent/project-continuity-owner-grants.mjs` now exposes an explicitly called `rekeyContinuityOwnerAuthority({root,signerDir,oldPassword,newPassword})` method.

The owner must know the existing encrypted-key password. Rekey decrypts that key in process, confirms it matches the pinned public key, creates a **new AES-256-GCM encrypted envelope** with fresh scrypt salt and IV under the new password, verifies that the new envelope decrypts into the same public identity, and atomically replaces the old encrypted file. No public-key rotation, project deletion, consent reset, raw private PEM on disk, or change to the official login password occurs.

The operation checks a no-auto-recovery lock file, requires a minimum twelve-character new password, rejects a repeated or incorrect password, checks for concurrent change before replace, writes via private temporary file and `fsync`, then renames within the signer directory. A crash before rename keeps the old encrypted key; a crash after rename keeps the new one. An orphaned lock requires explicit owner review and is not automatically stolen.

`device-agent/operator-agent.mjs`, `local-wall.mjs` and `project-continuity-page.mjs` wire rekey through the experimental Local Wall, with the normal owner-authenticated session, CSRF, a shared failed-attempt rate limit, and a **fresh verification of the new login password**. The owner must first update the actual Light Remote Account / Local Wall login password through its existing independent mechanism, then supply the old signing-key password plus the new login password. The new form **does not change login credentials**. This sequencing must be documented in help text and physically tested.

The key is never rewrapped over MCP, generic Continuity IPC or a remote device job. The experimental user-facing form clears both fields immediately after submit.

### 2. Immutable cryptographic provenance of remote-read consent

`device-agent/project-continuity-store.mjs` migrates local SQLite from v6 to v7, adding `remote_consent_attestations(project_id,grant_json,signature,recorded_at)`.

Each owner-signed enable grant now stores its signed attestation alongside the existing consent flag. `remoteBrief` requires a valid Ed25519 signature, project scope, enable action, previously consumed nonce and enabled flag. The **30-second grant is verified for freshness at issuance**; historical signed authorization is checked cryptographically when reading, not rejected simply because the short-lived issuance token has expired. Disabling consent or Project Memory deletes the attestation. An old v6 database carrying only `enabled=1` is denied after v7 migration until the owner reauthorizes.

This prevents *simple* editing of SQLite `enabled=1` from granting remote access without a valid receipt. It is **not rollback-proof** against a same-UID attacker that can replace the public key, database and matching signed older snapshots; OS isolation and a separate trust anchor remain required.

### 3. Focused evidence

- `P2_REKEY_PRESERVES_PUBLIC_IDENTITY_AND_CONSENT_PASS`
- `P2_REKEY_WRONG_PASSWORD_AND_LOCK_FAIL_CLOSED_PASS`
- `P2_REMOTE_CONSENT_SIGNED_RECEIPT_AND_SQL_TAMPER_DENY_PASS`
- `P2_LEGACY_V6_UNSIGNED_REMOTE_CONSENT_DENIED_PASS`
- `P2_LOCAL_WALL_OWNER_REKEY_AFTER_PASSWORD_CHANGE_PASS`
- Existing SQLite P1, P2 Memory/Relay/Consent and Codex mock suite remain source-level only.
- Tests live in `deploy/scripts/selftest-project-continuity-rekey-consent.mjs` (new) and updated `selftest-project-continuity-owner-stepup.mjs`/`selftest-project-continuity-p2.mjs`.

## Persistent safety limits / Do not close release gates

1. An OS-isolated Owner Consent Broker, dedicated service identity and Windows named-pipe ACL are **NOT** implemented or physically accepted. Same-user DB/public-key modification and live credential interception remain possible.
2. There is no trusted monotonic rollback-proof audit outside SQLite. Signed consent attestation makes simple flag tampering fail closed, but does not establish a general anti-rollback system.
3. Account-only login rekey against the real operator authentication server, Linux/macOS packaging and Windows password-rotation UI have **NOT** been physically tested.
4. Old plaintext-PEM development pilots do not auto-migrate; repair/recovery must be explicit. On-disk KDF metadata is retained for AES-256-GCM key envelope, with password known only to the owner.
5. No live ChatGPT new-conversation Context MCP proof, full proxy/Plugin/Operator tracing audit, real authorized Codex app-server, or signed delegated worker.
6. **Do not create a Windows installer yet.** Gate remains BLOCKED; owner asked for one integrated build after all critical feature gates are ready.

## Next slice

Build an OS-isolated Owner Broker proof of concept on the Linux Gold development host using a dedicated service identity and restricted filesystem/socket permissions, **without changing existing Gold UAT services**, then design the matching Windows named-pipe SID/ACL policy. Verify OS owner separation and public trust-anchor immutability before claiming the owner security gate. After that, validate the confidential Plugin/Operator path against real isolated services and live ChatGPT cross-session Memory with explicit consent. Keep source docs/handoff on every development turn.

## Workspace safety

Changes are isolated to `feature/project-continuity-plan-20261023`; keep the pre-feature Gold rollback SHA and Windows #486 feature parity untouched. No migrations of production PostgreSQL/Redis or changes to the Gold UAT unknown job ledger were performed as part of this slice.
