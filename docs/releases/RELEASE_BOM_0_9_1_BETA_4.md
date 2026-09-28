# Release BOM — 0.9.1-beta.4

## Canonical identity
- Version: 0.9.1-beta.4
- Release branch: release/golden-0.9.1-beta.4
- Golden runtime BOM SHA256: 17c9dea9bfc7db912fd301130ff53fc2b23dbd59ee727b62a6f2183ca5134596
- Compatibility floor: 0.9.0-rc.26

## Frozen production reference
- Vercel deployed reference: 3b2e2e67e099277da0eaca19746bc360a04503ed
- Wall presentation reference: 57e641167572e4de9b794f9c783cc491aea42698
- Agent-client registry reference: 05c3bb1eb38121fb3b9ae0efee9682d02c884b4b
- Validated Windows Core baseline: 0.9.1-beta.1@6b58ce1535d3054265626da622c0f152868f1c4e

## beta4 stable source composition
- Stable base: 6b58ce1535d3054265626da622c0f152868f1c4e
- Vercel/client continuity: 503fa97326e317ee020536fd210843a3de312914 + 204e654700c818f8837449c7f4f1342a0ef0a594
- Late-result / 410 recovery: 33ff0b4e69b919d920f053c87843dc5fd03c4267
- Result-delivery packaging: 0ae6f58d19811ab0bbbc8a9c3630e302ac1f607c
- Wall UI baseline: 57e641167572e4de9b794f9c783cc491aea42698, stable-only subset plus beta4 polish
- Active stable source excludes computer-use runtime code and the retired Netlify lane.

## beta4 hotfix additions
- Restores the original install ordering: rollback installer cache is created before fail-closed background-task bootstrap runs.
- Fixes an early browser runtime crash caused by invoking the server-only materialIcon() helper from inline Wall JavaScript.
- Settings icon is now rendered server-side before the page reaches the browser.
- Windows installer task migration is fail-closed: legacy tasks must be removed, the agent task action must be --agent-host, and task bootstrap failure aborts setup.

## beta4 Wall additions
- Neutral silver/black fallback badges for ordinary unclassified commands.
- Settings icon aligned with the rest of the Wall controls.
- In-Wall toast/action feedback for copy, pairing, connect/disconnect, pause/resume, navigation and enrollment actions.
- Refresh A short 360-degree spin plus success/error feedback.
- Manual held/orphan session cleanup; no automatic closure and no closure while active jobs exist.

## Acceptance gates
- Full stable-scope scan.
- lr1 client continuity and bridge pairing/exec regression.
- Late-result receipt and persisted abandoned-command recovery.
- Local Wall render, inline JavaScript syntax, manual-session-cleanup and action-feedback contract.
- Result-delivery package manifest.
- Canonical version-plane parity.
- Cross-platform client/server/bridge CI.

## Distribution artifacts
- Windows x64 full and compact installers.
- macOS x64 and arm64 packages.
- Linux x64 and arm64 client packages and debs.
- Linux Server/Hub x64 and arm64 bundles.
- Vercel bridge bundle.
- Universal Fleet Wall module.
- release-provenance.json, unsigned update manifest and SHA256SUMS.

## Promotion rule
Do not promote the signed update channel or replace the currently rolled-back golden Vercel/ARM production runtime until immutable beta4 artifacts pass CI and real-device A/B acceptance.
