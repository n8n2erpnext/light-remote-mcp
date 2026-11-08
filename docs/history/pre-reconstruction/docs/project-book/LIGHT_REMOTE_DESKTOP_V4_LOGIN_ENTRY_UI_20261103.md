# Desktop V4 Login-first / Figma and Google Sans / UI-only CI handoff
Date: 2026-11-03; branch: feat/desktop-v4-login-entry-20261103

## Owner-approved UX direction
The 9-screen V4 workspace remains visually frozen at original code SHA 73d448e9.
Opening Desktop must show account entry BEFORE any workspace navigation/sidebar.
Login/Owner server session is separate from per-Agent A/B authorization and device link.
Typography: **Google Sans Flex in Figma**, **Google Sans Variable from repository on App**.
Review positions, whitespace, card sizes, wrapping and Light/Dark at multiple resolutions.

## Moryqa Figma new frames (original baseline preserved)
Source file Light Remote AI UI/UX, file key wfvLVoNvzVzyNHq51U0DPB.
- 63:76 Login light; 63:105 Login dark.
- 63:244 browser pending/restore/App Lock light; 63:278 dark.
- 63:312 expired/wrong Owner/sign out light; 63:346 dark.
- STOCK original logo 34:4 cloned into all new frames.
- Moryqa created six frames. Initial create_screen created Inter text by default. Replaced visible typography with Moryqa figma_import_svg editable text in Google Sans Flex and transparent overlays (17 text groups per frame). Inter/earlier partial overlays were grouped and hidden, not displayed.
- Imported overlay IDs: 64:403, 64:428, 64:453, 64:509, 64:480, 64:536. Each inspected with Moryqa; first editable text has fontFamily Google Sans Flex. All SVG text nodes explicitly request Google Sans Flex.
- Archived/hidden groups: 64:427+64:565 (login light), 64:452 (login dark), 64:507 (entry light), 64:563 (entry dark), 64:508 (recovery light), 64:564 (recovery dark).
- Two incomplete experiments 63:134 / 63:189 remain hidden.
- Windows Figma was observed directly with Light Remote Gold. Side-by-side sign-in Light/Dark appears aligned with visible card, rule, logo and clear CTAs.
- Layout reference 1440x900: left brand region 640 px, right sign-in card 585 px, standard text/button spacing, 52-56 px primary CTA; 3 cards per row in state boards.

## React / Tauri UI pilot implementation
- AuthEntry.tsx and auth-entry.css: outside-shell login UI with Light/Dark/System, Google Sans via existing repo CSS @font-face alias Light Remote Google Sans (GoogleSans-Variable.ttf). Six specimen states (browser pending, restoring, app-lock, expired, wrong account, sign-out) are design previews only.
- App.tsx gates all routes before sidebar; arbitrary hash does not bypass. Login CTA disabled until proper verified OAuth PKCE callback and secure persistence implementation exists.
- CI-only VITE_LR_V4_UI_TEST=1 exposes clearly labelled in-memory Explore UI (design preview), exit returns to sign-in. Production compilation omits preview flag and remains gated.
- App.test.tsx and e2e/visual-smoke.mjs: direct-hash gate, no stored Owner auth, login states, Google Sans font load and logo, no horizontal/card overflow, Light/Dark viewport geometry, plus original V4 screens after manual UI-preview entry.
- No Owner credentials, cookie copying, local grant, OAuth token, synthetic connection or lasting sign-in is generated. Not an authenticated release.
- Native Windows/macOS/Linux builds must happen on GitHub Actions; not on VPS-ARM. No Gold UAT changes, no installed WinForms replacement.

## Required security integration after UI acceptance
Real Login: system browser -> OAuth authorization code + PKCE -> verified one-time desktop callback -> OS credential vault & revocation -> device/account authority -> App to Local Wall one-way SSO through signed short-lived proof. Never use localhost reachability or test preview as account authorization; A/B consent remains explicit.
Exact CI run, source SHA and screenshots: complete after GitHub validation.
## FINAL CI RECEIPT — 2026-11-03
- Exact tested source commit: 4878db759613d1c0d446e1ec5e5ba415a3301100 (initial UI source 0b229bc3 plus null-safe TypeScript fix).
- GitHub Actions native V4 workflow: https://github.com/n8n2erpnext/light-remote-mcp/actions/runs/41569151264
- Completed SUCCESS 4/4: Web TypeScript+Vitest+Chromium visual; Windows Tauri; macOS Tauri; Linux Tauri.
- Chromium evidence.json: 30/30 PASS. Auth Light and Dark 1440x900, 1280x800, 1024x1024, intermediate widths and Dark 390x844; no horizontal/card overflow, logo loaded, Google Sans alias loaded. Existing nine V4 workspace screens still pass in ephemeral design preview.
- Native artifacts uploaded by GitHub: desktop-v4-tauri-pilot-windows-latest-41569151264 (6,135,808-byte unsigned .exe), desktop-v4-tauri-pilot-macos-latest-41569151264, desktop-v4-tauri-pilot-ubuntu-24.04-41569151264. These are portable UI-only executables, NOT installer bundles and NOT replaced production Agent.
- QA visuals physically inspected from Chromium artifact: Login Light 1440x900 and Dark 1440x900, Dark 390x844 all coherent. Figma on Windows inspected with Light Remote Gold separately.
- Owner real Login, persistent session App->Wall SSO and native installed app functional acceptance are still OPEN. Never mark these as production capable based on UI CI. Owner can review test artifact without affecting device enrollment.
- The build's Continue in browser is intentionally disabled until secure OAuth PKCE + one-time signed callback + OS vault contract exists. UI TEST ONLY Explore UI preview explicitly does not grant Owner authority or persist authentication. Production compilation without preview flag stays behind Login gate.
