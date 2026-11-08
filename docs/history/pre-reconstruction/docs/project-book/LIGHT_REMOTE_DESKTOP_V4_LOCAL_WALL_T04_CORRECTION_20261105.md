# Light Remote GoldABV2 × Desktop V4 — Local Wall / Owner SSO correction
**Date:** 2026-11-05 ICT
**Status:** T04b9c3c2 topology correction accepted by Desktop native CI 7/7, 2026-11-05; SSO installed E2E remains OPEN. Not a new product architecture.
**Canonical continuity:** `LIGHT_REMOTE_GOLD_DESKTOP_V4_LIVING_MASTER_HANDOFF.md`. This subject handoff supplements, never supersedes it.

## Owner-confirmed product architecture (immutable scope)
- Light Remote is local-first: Cloud Account/Plugin/Operator + device-owned Agent + its Local Wall + small Tray. Desktop V4 is a first-class GUI **on the same host as the installed Agent**, not a second Agent, an LXD Wall client, or a new cloud control plane.
- Before Desktop V4 the GUI was largely Tray and browser Wall. Tray's right-click menu cannot accommodate real Owner administration/Agent approvals. Desktop V4 brings a unified UI on Windows/macOS/Linux GUI; OS-specific adjustments only. The current nine screens are frozen.
- Desktop users can manage/approve A/B V2 sessions **without opening Wall**. Tray remains for quick actions, Wall remains an optional full web UI; Linux headless server owners use Local Wall WebUI and CLI, no Desktop GUI.
- A/B V2 evolves A/B V1 and supports future IT Support. Owner login/SSO does **not** approve B codes, authorize commands, increase device policy, or bypass independent Agent grants. Keep existing per-Agent leases and owner approval.
- The installed Linux server script already detects NetBird and supports binding according to local config. Whether users make their own Wall reachable via NetBird/SSH/reverse proxy is their choice; no centrally hosted Wall, cloud tunnel or remote-access product backlog is required.

## Address and trust ownership
| Address | Meaning |
|---|---|
| `http://127.0.0.1:5491/` | **The Local Wall of the host running Desktop/Agent**, whether Windows, macOS, Linux GUI or headless Linux. On each host this loopback is different. Open Wall, Logs and anonymous Wall probe must use this exact local host. |
| `http://100.94.184.141:15591/` | **VPS-ARM NetBird → NAT/LXD proxy → `127.0.0.1:5491` INSIDE isolated Linux LXD**. Only an Owner remote-test route to that Lab Wall. Never Desktop Windows' Wall target. |
| `https://goldabv2.light-remote.thaiduy.digital` | GoldABV2 Account Portal/Owner PKCE, Plugin and Operator backend for isolated Lab. Separate from Local Wall. |
| `https://goldabv2.light-remote.thaiduy.digital/mcp` | GoldABV2 MCP route, not Desktop login authority or Wall URL. |
| `https://gold.light-remote.thaiduy.digital/mcp` | Older Gold endpoint used by existing installed Windows client; not GoldABV2 Lab. |

Actual LXD Wall live binary is run as `light-remote-gold-wall.service` with `device-agent/operator-agent.mjs daemon` inside container `light-remote-abv2-lab-20261101`, according to read-only systemd ExecStart checked 2026-11-05. Do NOT infer this means Desktop Windows should open LXD Wall.

## T04 Owner SSO contract — TWO directions
1. **Most common App → Wall:** Owner logs into native Desktop V4 using GoldABV2 Account Portal, Rust PKCE and OS credential vault; then opens its **same-host** `127.0.0.1:5491` Wall, which verifies Owner without another password.
2. **Required Wall → App:** Owner logged into same-host Local Wall opens Desktop V4; native app verifies that Owner using an authenticated, bounded *same-device* handoff and current backend Owner family, then obtains its own valid native session. Do not equate the browser cookie/HTTP401 status with native login, and do not copy raw Wall cookies/passwords into the app.
3. Either direction maintains separate Owner session representations. Log-out/revocation/relink invalidates dependent access. The Owner Portal cookie, native token/OS vault, Wall HttpOnly cookie and A/B grant remain distinct trust domains.
4. A/B V2 approval must work natively inside Desktop without depending on Wall being opened. Desktop UI can expose the same Owner decision capability without silently mutating a grant.
5. T04b9c3c1 source supports **App → Wall only** (browser challenge/short code, OS-private Agent IPC, Ed25519 signed redeemer, Wall cookie). Bidirectional Wall → App native trusted handoff is **NOT IMPLEMENTED**, and full installed E2E is **NOT VERIFIED**. Do not claim it is complete.

## 2026-11-05 topology repair and honest baseline
- Current Desktop V4 `main.rs` used `LR_V4_WALL_PROFILE=goldabv2-lab` to open NetBird/LXD Wall as its native Open Wall/Logs/probe. This is a QA-only routing error, NOT product design. Remove it: always same-host 127.0.0.1:5491. Keep Rust `owner_login.rs` bound to GoldABV2 HTTPS backend.
- Retire the special native rejection tied to that remote Wall profile; native SSO remains OFF in ordinary builds until a **same-host GoldABV2 Agent** is independently installed/staged and accepted. Existing Windows Agent still points to older Gold; do not call its port-5491 state GoldABV2 E2E.
- A previous attempt to activate SSO inside `device-agent/operator-agent.mjs` via `desktop-wall-sso-lab-activation-v4.mjs` had incorrect scope and untested key assumptions. Those two *uncommitted-only* edits were reversed from the Gold branch on 2026-11-05, before CI/runtime deployment. Existing signed SSO modules remain SOURCE ONLY/default OFF. No LXD service restart.
- Source-level guard `client/desktop-v4/e2e/desktop-local-wall-route-contract.mjs` now checks no NetBird/LXD Wall URLs or build profile in Desktop native source/CI, fixed localhost Wall/Logs/probe, and independent GoldABV2 Owner HTTPS auth. Existing Vitest native-shell tests updated.

## Next execution (no shortcuts)
A. Accept exact source correction through GitHub Desktop V4 UI/native CI and Project Truth / Docs workflows. Native Windows/macOS/Linux builds run on GitHub Actions, never on VPS-ARM.
B. Verify that a **separate explicitly GoldABV2-enrolled same-host Agent** and Desktop candidate can coexist without modifying current Windows Gold Client or unrelated tests. Resolve package/name/runtime conflicts before installing.
C. Implement App→Wall SSO Agent mount only on that same-device Agent, with real local Owner proof and OS-private IPC. Verify Owner/Redis/Ed25519 and browser 127.0.0.1 Wall cookie E2E. Do not test via LXD NetBird Wall.
D. Implement **Wall→App** trustworthy local credential exchange/Owner PKCE equivalent, without taking over browser cookies or exposing credentials; test native session restore and revocation.
E. Independently expose real Owner A/B V2 approval/actions inside Desktop V4. Keep existing UI and Cloud/Agent architecture.
F. Record exact CI SHA/artifact hash, source-only vs live runtime vs owner-accepted physical Windows. No production/UAT/live Gold Client release until verified. Source patches alone do NOT prove SSO.

## Worktree / handoff discipline
Gold canonical worktree `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/goldabv2-desktop-owner-lab-20261103`; Desktop worktree `/home/ubuntu/n8n2erpnext/light-remote-mcp-worktrees/desktop-v4-shared-ui-20261101`. Keep canonical Living Master byte-identical in both; update Worklog, Code Map, Current Checkpoint; use Project Truth --stamp/--staged/--head. The current Gold Lab 5-service health, public mTLS and LXD service source are independent of Desktop native CI. Never collapse CI PASS into installed SSO PASS.

## Latest CI receipt — 2026-11-05
- Desktop source commit e55f8b2dc33732f43f235914820d4217a4c89128.
- GitHub native UI+Owner LAB workflow 42010747527: 7/7 PASS for Windows, macOS, Ubuntu, including 56 UI tests, 25 Owner contract tests, Chromium, packaging, local-Wall routing regression.
- Unsigned Owner Login LAB Windows artifact ID 13406663382; EXE SHA256 6879964559B57D3B689390961B487F0E5FE0DDDAF6C20C00CA4B708733D30216.
- Native SSO still default OFF; physical GoldABV2 Agent on Windows, App→Wall, Wall→App, and in-App A/B V2 remain unverified.
