# rc50 P0-B — strict Local Wall owner approval stage (NOT Agent-wired)

Date: 2026-10-16 Asia/Ho_Chi_Minh. Branch: feature/rc50-mjs-scale-20261011. Base SHA: fc5ae5265caa46b97b1738e8cbf9c50e801bb4a6.

## Real approval gap
The real Local Wall has two POST routes that invoke accessApprove: (1) POST /api/approve resolves pending B code before calling approve, with owner cookie + session CSRF when auth is enabled; (2) legacy POST /api/access/:requestId/approve accepts a known request ID without B-code lookup. In local auth-disabled mode the device intentionally trusts localhost. This compatibility mode is NOT independently signed owner intent at a real issuer.

## Implemented in actual Local Wall handler
Added startLocalWall({requireAuthenticatedApproval:false}) constructor option. It is OFF by default and existing product behavior is unchanged. When explicitly true, startup fails unless auth.enabled and session identity+CSRF verification are provided; legacy direct-ID approve is rejected HTTP 403 wall_approval_requires_b_code before the accessApprove callback; normal B-code approve keeps real owner session, CSRF and pending-code checks. Denial is separately permitted and cannot mint a grant.

## Hard tool block: no Agent integration, no workaround
An attempt to wire an explicit dev strict flag into the TWO actual startLocalWall invocations in device-agent/operator-agent.mjs was BLOCKED by tool safety review. We did NOT use a different tool, PTY or shell to make that denied edit. Therefore the strict handler option is ONLY manually enabled on isolated Local Wall UAT instances and is NOT connected to the regular Agent startup. There is no active LR_RC50_DEV_STRICT_WALL_OWNER_APPROVAL launcher flag. Source negative gate confirms this unwired state. The existing real Agent approval behavior is unchanged. Do not claim P0-B completion.

## Actual isolated HTTP tests
platform-v2/portability/test_real_wall_owner_approval_http_uat.mjs gained a live HTTP test (not a mock router): real Local Wall started on 127.0.0.1 with private disposable auth state, fake pending B request and mock accessApprove. Assertions: auth-disabled strict startup fails; direct requestId route returns HTTP 403 and never invokes approval; missing owner session returns 401; wrong B returns 404; valid authenticated owner session plus CSRF plus correct B approves exactly once. No real device/grant/customer key used. VPS-ARM 14/14 real Local Wall cases PASS; full Node 57/57, release guards 11/11, writer guards 14/14 PASS.

## Hard P0 still NOT_READY
P0-A lacks shared authenticated writer epoch/Agent fence. P0-B lacks a protected owner signer and real channel ACK → independent verifier/issuer → Agent authority, and strict route is still unwired. P0-C has two previously blocked JSON registry fsync paths and no global consistent checkpoint. P0-D has no full ARM-state→HOMELAB-state restore+rollback. P0-E needs full authenticated service E2E/signed release acceptance. Existing tool-blocked PG adapter, verifier runner and registry writes were not bypassed. No main merge, production changes or real A/B grants.

Native GitHub Actions results must be verified on the NEW commit SHA before claiming CI success.
