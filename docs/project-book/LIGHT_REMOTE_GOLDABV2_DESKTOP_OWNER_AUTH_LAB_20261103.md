# GoldABV2 Desktop V4 Owner Auth — isolated Lab source overlay (2026-11-03)

## Scope / trust boundary
- New isolated branch `feat/goldabv2-desktop-owner-lab-20261103`, BASE `b9cf02de4bc515a1926b86e5f7d08f8876149e7d` (GoldABV2 R5 device-local activity logs). Original Gold and Desktop branches are unchanged.
- Goal: make a compatible GoldABV2 backend candidate for Desktop V4 T03c2c WITHOUT overwriting current single Owner transfer, per-Agent A/B, Wall R5, Local Activity Logs, or original Chrome LM integration.
- SOURCE ONLY: No service restart, LXD snapshot restore, Redis/PG migration, Owner flag enable, Windows Agent replacement, or Gold UAT/production deployment. Both `LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4` and `LR_GOLD_ABV2_DESKTOP_TOKEN_V4` remain default OFF. T03c2c real Owner Login E2E and T04 App-to-Wall SSO are OPEN.

## Compatibility changes
- Copied and adapted the Desktop-only pure PKCE contract, browser consent/one-time Redis code, revocable hashed opaque access/refresh service and 3 tests from `feat/desktop-v4-api-integration-20261103`. Server registration added to Gold plugin-server/server.mjs behind two distinct exact feature gates. The existing MCP_RESOURCE token and /mcp handler are untouched.
- Added `AccountRegistry.desktopOwnerSessionActive(accountId,sessionId)` to the CURRENT Gold account registry rather than replacing the full file. It verifies active session ID, account status, `accountId===ownerAccountId`, and `!ownerTransferPending`. Owner transfer immediately invalidates prior Desktop authority.
- Added ONLY `POST /v1/accounts/desktop-session-check` to current Gold Operator routes. This is an internal Operator transport session check, not a public native login endpoint or bearer credential.
- Hardened Browser Owner proof: `browserOwnerFromOperator` rejects any account where `account.isOwner!==true`. Pure contract and consent completion also demand `isOwner===true`. A signed-in non-Owner, Guest or prior Owner must not unlock native Owner workspace.
- The Gold-only `transferOwner`, `ownerRevision`, authority singleton, admin job recovery, ABV2 session grants and installed Activity Log module are preserved. Directly copying Desktop branch `operator-host/account-registry.mjs` would delete these and is forbidden.

## Test evidence
- Offline Node 22 syntax for six touched server/operator files: PASS.
- `node --test plugin-server/desktop-auth-v4-contract.test.mjs plugin-server/desktop-auth-v4-server.test.mjs plugin-server/desktop-owner-token-v4.test.mjs`: 25/25 PASS, including negative non-Owner and after Owner-transfer session check.
- `LR_GOLD_SINGLE_OWNER_AUTHORITY=1 LR_GOLD_SINGLE_OWNER_TRANSFER=1 node deploy/scripts/selftest-gold-single-owner-transfer.mjs`: PASS using synthetic temp data. These env flags were set ONLY for the local test process, not any Lab service. First attempt without test flags returned expected `owner_handoff_feature_disabled` (not a source regression).
- GitHub Gold Source Gate and Documentation CI: PENDING until exact source commit/push; do NOT report CI acceptance yet.
- Desktop native refresh source `be91bf70` CI 41604858829 4/4 PASS (12 Rust tests on each OS). Separate unsigned Owner LAB candidate workflow `73b41e86` run 41605694255 in progress. Neither proves live Owner E2E or backend runtime.

## Isolated Lab preflight / rollback
- Live LXD `light-remote-abv2-lab-20261101` previously read-only checked: Operator, Plugin, Wall, Process Supervisor 4/4 active; HTTPS health 200.
- Current Plugin runtime `source-856c4684-plugin-overlay-14f8bfed` and Operator `source-94933590-op-overlay-ddd012b1` lack Desktop auth modules/session-check; all four desktop HTTPS paths returned 404. No flags were changed.
- BEFORE staging: recheck source/runtime, create a current LXD code rollback snapshot and independent backed-up service overrides. Avoid restoring whole LXD snapshot after mutable PG grants; rollback ONLY services/code when possible. Verify baseline four services and Owner grants before any cutover.
- Stage only a compatibility-checked source overlay from THIS branch, with both Desktop flags OFF. Test exact startup import closure/Node syntax, Account Portal login, Owner Transfer, A/B, Activity Logs and /mcp. Only then consider separately authorized feature-ON Lab browser/token testing and unsigned Windows binary E2E. Never send Desktop bearer/refresh to HTTP NetBird Wall.
- Maintain Project Truth on each source commit; no repo-wide merge into Gold UAT, default main or production. Preserve original Owner identity and independent B approval.

## Next gate
Commit/push this isolated source branch with Project Truth. Verify Gold Source Gate 4/4 and docs integrity. Inspect candidate binary CI. Prepare Lab rollback and staged source with flags OFF, then reproduce Owner login only with explicit owner consent. T04 signed one-use App-to-Wall SSO remains blocked until T03c2c physical acceptance.
