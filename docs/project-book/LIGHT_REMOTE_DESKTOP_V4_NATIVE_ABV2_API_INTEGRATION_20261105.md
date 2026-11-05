# T05A — Desktop V4 real Owner + Agent A/B V2 native API handoff
2026-11-05 ICT | Source implemented; Agent local Node tests 4/4 PASS; full Desktop CI and physical E2E pending.

## Purpose
Desktop V4 is the primary GUI for Owner approvals with the installed SAME-HOST Light Remote Agent. User can approve Agent A/B V2 without opening browser Wall. Existing Tray, Agent, Cloud Operator, local Wall and per-Agent security are retained. Linux headless still uses Local Wall/CLI. Local Wall is localhost:5491 on its OWN host; VPS-ARM NetBird 100.94.184.141:15591 is ONLY Linux LXD remote QA, NOT the Windows Wall.

## Actual API path
1. Native Rust Owner Login uses existing GoldABV2 browser PKCE/OS vault. It independently verifies the current GoldABV2 Owner session. WebView never receives Owner access/refresh tokens.
2. Rust sends bounded Owner-authenticated request over fixed OS-private SAME-HOST IPC: Windows named pipe light-remote-desktop-v4-abv2 or Linux/macOS same-user 0600 Unix socket under private .light-remote directory. No new HTTP/Wall URL.
3. Only GoldABV2-enrolled Agent with feature LR_GOLD_ABV2_DESKTOP_ABV2_NATIVE_V4=1 (OFF by default), exact GoldABV2 HTTPS hub/base, loopback local Wall and local Owner auth may start listener. Agent validates Owner Bearer against HTTPS /account/desktop/v4/session and accountId matches active nonrevoked enrollment.
4. Agent requests existing Ed25519-signed Operator abv2-pending-preview; responses limited to up to 5 pending requests and only requestId, attempt, expiresAt, A code, shortId. Rust strips any extra fields; React validates projection. No synthetic rows.
5. For Approve, Owner enters B in Desktop (and consent if existing policy requires it). Rust checks Owner session generation, Agent verifies Owner/enrollment and CURRENT request again, then invokes EXISTING signed abv2-owner-approve. Only durable state granted is success. No bypass of B, device local policy, Agent grants or Owner revocation.
6. App AI Access now shows live request/Short ID/A/B input, Refresh and Approve; Overview shows count only from verified native data. If no matching Agent, show unavailable instead of fake zero.

## Exact source touched
Gold branch: device-agent/desktop-abv2-native-ipc-v4.mjs and .test.mjs; device-agent/operator-agent.mjs gated daemon listener and live Owner verification; client/core-files.json now packages 129 files.
Desktop branch: client/desktop-v4/src-tauri/src/owner_abv2.rs, owner_login.rs, main.rs, build.rs and permissions/desktop-owner.toml; client/desktop-v4/src/lib/native-abv2.ts and .test.ts; src/App.tsx; .github/workflows/desktop-v4-native-ci.yml. Owner LAB candidate enables VITE_LR_V4_ABV2_NATIVE=1. UI-only build does not have native Owner approval commands. The branches have DIFFERENT historical Agent code; do not overwrite one whole operator-agent.mjs with another.

## Tests and unresolved acceptance
Gold local Node native IPC: 4/4 PASS, including default OFF, socket permissions, Owner/enrollment checks, correct B and revoked denial. Native Rust/TypeScript GitHub CI and Windows/macOS/Linux binary: PENDING until exact run accepted. Existing Windows installed Agent points Gold old endpoint and was not replaced. No physical GoldABV2 Owner-to-Agent B grant E2E has been run. Two-way App/Wall SSO, verified active session/grant list and other Desktop API panels are separate OPEN work. No production/Gold UAT/LXD runtime, Owner data, keys, firewall or A/B grants changed.

## Next steps
Accept Project Truth, Docs and native CI; prepare separate GoldABV2-enrolled Agent QA on SAME host without corrupting old Gold installation; test real Owner login, pending display, short ID/A and B approval, durable grant, revocation. Then connect active grants/Sessions and complete two-way Local Wall SSO. Do not call source build physical PASS.

## Exact source CI acceptance (2026-11-05)
- Agent source 1642dc3a and Gold Source Gate 42018349829 PASS; Native IPC 4/4 PASS.
- Desktop native source 342ceaa1, workflow 42019133001 SUCCESS 7/7; UI 60/60, Owner contracts 25/25; Windows/macOS/Linux Owner LAB binaries generated.
- Windows Owner LAB EXE SHA256 68286F22344F9271F842E75AF0AAC30C8438D96649B83F8C30B1AC72D358946B, GitHub artifact 13411585522.
- Physical same-host GoldABV2 Agent/Owner B E2E untested. Installed Windows Agent remains older Gold. New local IPC flag OFF. Do not claim actual grant.
- GoldABV2 LXD Owner Login temporary QA extended to 19:44:01 ICT via separate active auto-off timer with rollback; SSO OFF.
