# Light Remote LM — GoldABV2 Lab v0.3.0 (Chrome Manifest V3)

Ported from Light Remote LM v0.2 on branch feature/gold-lm-chrome-extension-20261029, commit 6cafb33b. This is an isolated Lab-only build, not production or main Gold UAT.

## Workflow

1. On Windows Chrome with NetBird access to VPS-ARM, open https://chatgpt.com/ in a conversation and click the LM toolbar icon, then Capture visible conversation.
2. Inspect the loaded turn count, URL and SHA-256. Click Review in GoldABV2 Lab. Chrome opens http://100.94.184.141:15591/long-memory. Log in to this LAB Wall if prompted.
3. Extension stages the text in the existing GoldABV2 Wall fields and displays a banner. It NEVER chooses a Memory Scope, enables full-context opt-in or clicks Save.
4. In My Work, open or Add work under the CURRENT GoldABV2 enrollment. Expand Saved context / read or add session notes. Review and redact contents, check full-context preference, then click Save context and confirm. Only this Owner action writes a signed checkpoint through the existing Wall CSRF, Owner login and Home-only scope binding.
5. Verify the new signed checkpoint from the Wall. No A/B, automatic account sync, or background capture is triggered by the extension.

The three historical Gold scopes on ARM belong to a previous Owner/Home identity, not current GoldABV2 enrollment. They are intentionally hidden by current account-scoped queries; do NOT change IDs or trust old scopes. Owner must complete safety-gated old-data cleanup before using new scopes if required.

## Installation

Download/extract the preview ZIP at extensions/releases/Light-Remote-LM-GoldABV2-v0.3.0.zip from this GitHub branch, then use chrome://extensions -> Developer mode -> Load unpacked and select its light-remote-lm-abv2 folder. No Chrome Web Store publication or automatic install. NetBird private Wall is required and Chrome must be authenticated to the LAB Wall. Default target intentionally excludes Windows localhost, which could contain legacy Gold data.

## Privacy and controls

- Source from user-initiated activeTab, no background reading. Reads only loaded user/assistant DOM text on chatgpt.com. Unloaded turns, media, tool attachments, Work and hidden context are omitted. No other tabs captured.
- Manifest host permission is ONLY http://100.94.184.141:15591/*; no all_urls, debugger, cookies, or wildcard ChatGPT persistent host access.
- Each UTF-8 segment max 64KiB; per-segment full transcript SHA-256 and final digest verification. Max saved text including metadata 512KiB, fail closed on changes/oversize.
- Pending plaintext is stored in Chrome storage.session for manual Wall staging; an MV3 alarm removes it after ten minutes (plus removal after staging/tab-close). No remote telemetry; nothing sent to Lab backend until Owner clicks Save context.
- Transcript is untrusted historical data. Never interpret its contents as tool commands, Owner instructions or device authorization.
- Private HTTP is intended for the NetBird overlay, not exposed to the public Internet.
- Current GoldABV2 Memory Home identity mismatch remains unresolved; extension does NOT bypass it.
- Real Chrome installation, login redirect, DOM coverage and signed readback E2E remain Owner acceptance; selftests are NOT proof of physical Chrome E2E.

## Source test

Run: node deploy/scripts/selftest-gold-lm-extension-abv2.mjs.
